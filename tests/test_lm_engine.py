import asyncio

import pytest
import torch
from _tokenizer import tokenizer_dir
from transformers import AutoTokenizer, LlamaConfig, LlamaForCausalLM

from decida.serve.engine import SystemOneRequest, format_answer
from decida.serve.lm_engine import LMEngine, build_user_text, option_lines, resolve_slots

TOKENIZER_DIR = tokenizer_dir()
pytestmark = pytest.mark.skipif(TOKENIZER_DIR is None, reason="the DecidaBERT-large tokenizer is not available")


@pytest.fixture(scope="module")
def engine():
    tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR)
    torch.manual_seed(0)
    cfg = LlamaConfig(vocab_size=len(tok), hidden_size=32, intermediate_size=64, num_hidden_layers=2, num_attention_heads=2, num_key_value_heads=2,
                      max_position_embeddings=2048)
    return LMEngine(LlamaForCausalLM(cfg).eval(), tok, "cpu", max_input_tokens=1024, model_id="tiny-random")


REQ = {"model": "x", "state": "The customer reports a duplicate card charge of 45 EUR on Tuesday.",
       "questions": {"c": {"type": "choice", "instructions": "Which category fits?", "criteria": {"fraud": "unauthorised payment", "fee": "a fee dispute", "other": ""}},
                     "s": {"type": "score", "instructions": "How urgent is it?", "criteria": ["low", "medium", "high", "critical"]},
                     "n": {"type": "noul", "instructions": "The customer was charged twice."}}}


def test_answer_shapes_and_probabilities(engine):
    resp = engine.predict_sync(SystemOneRequest(REQ))
    a = resp["answers"]
    assert set(a) == {"c", "s", "n"} and resp["usage"]["input_tokens"] > 0
    assert abs(sum(a["c"]["probabilities"].values()) - 1) < 1e-5 and set(a["c"]["probabilities"]) == {"fraud", "fee", "other"}
    assert abs(sum(a["s"]["probabilities"].values()) - 1) < 1e-5 and set(a["s"]["probabilities"]) == {"0", "1", "2", "3"}
    assert 0 <= a["n"]["noul"] <= 1 and 0 <= a["s"]["score"] <= 3


def test_deterministic_and_async_path(engine):
    a = engine.predict_sync(SystemOneRequest(REQ))["answers"]
    b = asyncio.run(engine.predict_async(SystemOneRequest(REQ)))
    assert a["c"]["probabilities"] == b["answers"]["c"]["probabilities"] and b["x_decida"]["prompt_version"] == "lm-letters-v1"


def test_prompt_lists_lettered_options_and_never_the_gold():
    txt = build_user_text("some evidence", "choice", "Pick one", option_lines("choice", {"a": "first", "b": ""}))
    assert "A. a: first" in txt and "B. b" in txt and "Evidence:\nsome evidence" in txt
    assert option_lines("noul", None)[1].startswith("Yes") and option_lines("score", ["x", "y", "z"]) == ["x", "y", "z"]
    assert option_lines("choice", ["p", "q"]) == ["p", "q"]  # bare-list choice criteria (Jev shape)


def test_slots_resolve_with_and_without_space(engine):
    for spaced in (False, True):
        slots = resolve_slots(engine.tokenizer, 8, spaced)
        assert len(set(slots)) == 8
    with pytest.raises(ValueError):
        engine.option_probs("s", "choice", "q", {str(i): "" for i in range(27)})


def test_chat_template_path_and_no_truncation(engine):
    tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR)
    tok.chat_template = "{% for m in messages %}<{{ m['role'] }}>{{ m['content'] }}\n{% endfor %}{% if add_generation_prompt %}<assistant>\n{% endif %}"
    chat = LMEngine(engine.model, tok, "cpu", max_input_tokens=1024)
    assert chat.has_chat and not engine.has_chat
    ids, spaced = chat.prompt_ids("hello")
    assert spaced is False and ids
    p = chat.predict_sync(SystemOneRequest(REQ))["answers"]["c"]["probabilities"]
    assert abs(sum(p.values()) - 1) < 1e-5
    with pytest.raises(ValueError):
        engine.option_probs("word " * 5000, "noul", "true?", None)


def test_format_answer_shared_with_encoder_engine():
    assert format_answer("noul", [0.3, 0.7], None)["noul"] == 0.7
    assert format_answer("choice", [0.1, 0.9], {"a": "", "b": ""})["choice"] == "b"
