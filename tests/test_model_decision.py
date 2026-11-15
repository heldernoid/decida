"""The DecidaBERT-v2 format (model/decision_enc.py, serve/decision_engine.py): layout, loading, answers and detection.

A tiny random ModernBERT stands in for the 395M-parameter checkpoints, so nothing large is downloaded; only the
DecidaBERT-large tokenizer is needed (see _tokenizer.py), and the tests that use it skip without it.
"""
import asyncio
import json
import shutil
from pathlib import Path

import pytest
import torch
from _tokenizer import tokenizer_dir

from decida.checks import run_checks
from decida.model.decision_enc import DecisionLayout, DecisionModel, options, question_text
from decida.runtime.detect import Backend, detect
from decida.serve.decision_engine import DecisionEngine
from decida.serve.engine import SystemOneRequest

TOK_DIR = Path(tokenizer_dir() or "/nonexistent")
needs_tokenizer = pytest.mark.skipif(not TOK_DIR.exists(), reason="the DecidaBERT-large tokenizer is not available")

QUESTIONS = {
    "team": {"type": "choice", "instructions": "Which team should handle this?",
             "criteria": {"billing": "Charges and refunds", "tech_support": "Bugs", "sales": ""}},
    "urgency": {"type": "score", "instructions": "How urgent is it?", "criteria": ["Low", "Medium", "High"]},
    "refund": {"type": "noul", "instructions": "Is a refund requested?", "criteria": {"true": "they want money back"}},
}


def test_question_text_adds_what_yes_and_no_mean_only_for_yes_no_questions():
    assert question_text(QUESTIONS["refund"]) == "noul question: Is a refund requested? | yes means: they want money back"
    assert question_text(QUESTIONS["team"]) == "choice question: Which team should handle this?"


def test_options_keep_keys_and_order_and_write_underscores_as_spaces():
    assert options(QUESTIONS["team"]) == (["billing", "tech_support", "sales"],
                                          ["billing: Charges and refunds", "tech support: Bugs", "sales"])
    assert options(QUESTIONS["urgency"]) == (["0", "1", "2"], ["level 0: Low", "level 1: Medium", "level 2: High"])
    assert options({"type": "choice", "criteria": ["a", "b"]}) == (["a", "b"], ["a", "b"])
    assert options(QUESTIONS["refund"]) == ([], [])


@pytest.fixture(scope="module")
def tokenizer():
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(str(TOK_DIR))


@needs_tokenizer
def test_every_marker_is_a_mask_token_inside_one_sequence(tokenizer):
    enc = DecisionLayout(tokenizer, 512, 256, 96).encode("I was billed twice in March.", QUESTIONS)
    ids = enc.input_ids
    assert ids[0] == tokenizer.cls_token_id and len(ids) <= 512
    assert [qid for _, qid in enc.noul] == ["refund"]
    assert [(t, qid, keys) for _, t, qid, keys in enc.groups] == [("choice", "team", ["billing", "tech_support", "sales"]),
                                                                   ("score", "urgency", ["0", "1", "2"])]
    marks = [p for p, _ in enc.noul] + [p for poss, *_ in enc.groups for p in poss]
    assert len(marks) == 7 and all(ids[p] == tokenizer.mask_token_id for p in marks)
    assert not enc.state_cut and enc.options_cut == 0 and enc.dropped == []


@needs_tokenizer
def test_a_long_state_is_cut_at_its_end_and_the_questions_survive(tokenizer):
    state = "START " + "word " * 3000 + "END"
    enc = DecisionLayout(tokenizer, 512, 256, 96).encode(state, QUESTIONS)
    assert enc.state_cut and len(enc.input_ids) == 512
    text = tokenizer.decode(enc.input_ids)
    assert "START" in text and "END" not in text
    assert len(enc.noul) == 1 and len(enc.groups) == 2


@needs_tokenizer
def test_long_options_are_shortened_to_leave_room_for_the_state(tokenizer):
    long = " ".join(f"detail{i}" for i in range(80))
    qs = {"pick": {"type": "choice", "instructions": "Which one?", "criteria": {f"o{i}": long for i in range(8)}}}
    enc = DecisionLayout(tokenizer, 1024, 256, 96).encode("short state", qs)
    assert enc.options_cut == 8 and not enc.state_cut
    assert len(enc.groups[0][0]) == 8, "every option keeps its marker"


@needs_tokenizer
def test_questions_that_cannot_fit_are_reported_not_silently_dropped(tokenizer):
    qs = {f"q{i}": {"type": "noul", "instructions": "Is this one of many long questions? " * 10} for i in range(40)}
    enc = DecisionLayout(tokenizer, 256, 256, 96).encode("state", qs)
    assert enc.dropped, "questions past the context have no marker"


def _tiny_checkpoint(tmp: Path, tokenizer, seed: int = 0) -> Path:
    from safetensors.torch import save_file
    from transformers import AutoModel, ModernBertConfig

    torch.manual_seed(seed)
    cfg = ModernBertConfig(vocab_size=len(tokenizer), hidden_size=32, intermediate_size=64, num_hidden_layers=2,
                           num_attention_heads=2, max_position_embeddings=1024, pad_token_id=tokenizer.pad_token_id,
                           cls_token_id=tokenizer.cls_token_id, sep_token_id=tokenizer.sep_token_id)
    enc = AutoModel.from_config(cfg)
    layout = DecisionLayout(tokenizer, 1024, 256, 96)
    model = DecisionModel(enc, layout, {"noul": 0.5, "choice": 0.5, "score": 0.5})
    cfg.save_pretrained(tmp)
    save_file({k: v.contiguous() for k, v in model.state_dict().items()}, str(tmp / "model.safetensors"))
    for f in TOK_DIR.glob("tokenizer*.json"):
        shutil.copy(f, tmp / f.name)
    (tmp / "decision_config.json").write_text(json.dumps({"max_len": 1024, "head_max_tokens": 256, "option_max_tokens": 96,
                                                         "confidence_temperature": {"noul": 0.5, "choice": 0.5, "score": 0.5}}))
    return tmp


@pytest.fixture(scope="module")
def checkpoint(tmp_path_factory, tokenizer):
    return _tiny_checkpoint(tmp_path_factory.mktemp("decision"), tokenizer)


@needs_tokenizer
def test_a_checkpoint_folder_with_decision_config_is_detected_as_the_decision_backend(checkpoint):
    d = detect(str(checkpoint))
    assert d.backend == Backend.DECISION and d.calibrated and d.quality_mode == "specialist"


@needs_tokenizer
def test_loaded_model_answers_every_question_with_a_distribution_and_is_deterministic(checkpoint):
    model = DecisionModel.from_pretrained(str(checkpoint)).eval()
    a1, encs = model.predict("I was billed twice.", QUESTIONS)
    a2, _ = model.predict("I was billed twice.", QUESTIONS)
    assert list(a1) == list(QUESTIONS)
    assert [len(a1[q].probs) for q in QUESTIONS] == [3, 3, 2]
    for a in a1.values():
        assert abs(sum(a.probs) - 1) < 1e-5 and 0 < a.confidence <= 1
    assert a1["refund"].confidence >= 0.5
    assert {q: a.probs for q, a in a1.items()} == {q: a.probs for q, a in a2.items()}
    assert len(encs) == 1 and len(encs[0].input_ids) > 0, "a request that fits is one pass"


@needs_tokenizer
def test_a_checkpoint_without_the_heads_is_refused(tmp_path, tokenizer):
    from safetensors.torch import load_file, save_file
    ck = _tiny_checkpoint(tmp_path, tokenizer)
    w = {k: v for k, v in load_file(str(ck / "model.safetensors")).items() if not k.startswith("score_head")}
    save_file(w, str(ck / "model.safetensors"))
    with pytest.raises(ValueError, match="not a DecidaBERT-v2-format checkpoint"):
        DecisionModel.from_pretrained(str(ck))


@needs_tokenizer
def test_engine_responses_are_well_formed_for_all_fourteen_checks(checkpoint):
    engine = DecisionEngine.load(str(checkpoint), device="cpu")
    res = asyncio.run(run_checks(lambda req: engine.predict_async(SystemOneRequest({**req, "model": "tiny"}))))
    assert res["wiring_ok"] == res["total"] == 14


LONG = {f"q{i}": {"type": "score", "instructions": f"How often would article {i} mention the goal? " * 6,
                  "criteria": ["Never", "Rarely", "Sometimes", "Often", "Always"]} for i in range(60)}


@needs_tokenizer
def test_passes_keep_request_order_and_hold_at_most_five_questions_that_fit_beside_the_state(tokenizer):
    layout = DecisionLayout(tokenizer, 1024, 256, 96)
    groups = layout.passes("a short state", LONG)
    assert [q for g in groups for q in g] == list(LONG)
    assert len(groups) == 12 and all(len(g) == 5 for g in groups)
    for g in groups:
        enc = layout.encode("a short state", {q: LONG[q] for q in g})
        assert not enc.dropped and not enc.state_cut and enc.options_cut == 0


@needs_tokenizer
def test_passes_share_the_questions_evenly(tokenizer):
    layout = DecisionLayout(tokenizer, 8192, 256, 96)
    six = {f"q{i}": {"type": "noul", "instructions": f"Is {i} true?"} for i in range(6)}
    assert [len(g) for g in layout.passes("s", six)] == [3, 3]
    twelve = {f"q{i}": {"type": "noul", "instructions": f"Is {i} true?"} for i in range(12)}
    assert [len(g) for g in layout.passes("s", twelve)] == [4, 4, 4]


@needs_tokenizer
def test_a_pass_gives_the_same_answers_alone_or_padded_in_a_batch(checkpoint):
    model = DecisionModel.from_pretrained(str(checkpoint)).eval()
    batched, encs = model.predict("a short state", {k: LONG[k] for k in list(LONG)[:12]})
    assert len(encs) == 3
    alone, one = model.predict("a short state", {k: LONG[k] for k in list(LONG)[4:8]})
    assert len(one) == 1
    for k in alone:
        assert max(abs(a - b) for a, b in zip(alone[k].probs, batched[k].probs)) < 1e-4


@needs_tokenizer
def test_engine_reports_truncation(checkpoint):
    engine = DecisionEngine.load(str(checkpoint), device="cpu")
    resp = engine.predict(SystemOneRequest({"model": "tiny", "state": "word " * 3000, "questions": QUESTIONS}))
    assert resp["x_decida"]["truncation"] == {"options_cut": 0, "state_cut": True}
    assert resp["x_decida"]["passes"] == 1 and resp["usage"]["input_tokens"] == 1024
    assert set(resp["answers"]["team"]["probabilities"]) == {"billing", "tech_support", "sales"}


@needs_tokenizer
def test_questions_that_do_not_fit_in_one_pass_are_answered_in_several(checkpoint):
    engine = DecisionEngine.load(str(checkpoint), device="cpu")
    resp = engine.predict(SystemOneRequest({"model": "tiny", "state": "a short state", "questions": LONG}))
    assert resp["x_decida"]["passes"] == 12 and list(resp["answers"]) == list(LONG)
    assert resp["x_decida"]["truncation"] == {"options_cut": 0, "state_cut": False}
    alone = engine.predict(SystemOneRequest({"model": "tiny", "state": "a short state", "questions": {"q7": LONG["q7"]}}))
    assert alone["x_decida"]["passes"] == 1


@needs_tokenizer
def test_a_question_too_long_even_on_its_own_is_refused(checkpoint):
    engine = DecisionEngine.load(str(checkpoint), device="cpu")
    huge = {"pick": {"type": "choice", "instructions": "Which one?",
                     "criteria": {f"option{i}": "a long description " * 20 for i in range(255)}}}
    with pytest.raises(ValueError, match="too long to fit"):
        engine.predict(SystemOneRequest({"model": "tiny", "state": "s", "questions": huge}))


@needs_tokenizer
def test_structured_state_is_written_as_json_with_default_separators_as_in_training(tokenizer):
    layout = DecisionLayout(tokenizer, 512, 256, 96)
    state = {"ticket": {"id": 7, "text": "billed twice"}, "tags": ["billing", "urgent"]}
    as_trained = layout.encode(json.dumps(state, ensure_ascii=False), QUESTIONS).input_ids
    assert layout.encode(state, QUESTIONS).input_ids == as_trained
    assert layout.encode(json.dumps(state, separators=(",", ":")), QUESTIONS).input_ids != as_trained


def test_the_api_passes_structured_input_to_the_decision_backend_unchanged():
    from decida.runtime.detect import TAKES_STRUCTURED_INPUT
    assert Backend.DECISION in TAKES_STRUCTURED_INPUT and Backend.REMOTE in TAKES_STRUCTURED_INPUT
    assert Backend.ENCODER not in TAKES_STRUCTURED_INPUT
