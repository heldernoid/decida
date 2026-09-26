import asyncio

import pytest
import torch
from _tokenizer import tokenizer_dir
from transformers import AutoModel, AutoTokenizer, LlamaConfig

from decida.serve.clm_engine import (
    CLMEngine,
    candidate_texts,
    load_heads,
    make_head,
    state_text,
    to_text,
)
from decida.serve.engine import SystemOneRequest

TOKENIZER_DIR = tokenizer_dir()
pytestmark = pytest.mark.skipif(TOKENIZER_DIR is None, reason="the DecidaBERT-large tokenizer is not available")
HIDDEN, PROJ = 32, 16


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR)
    tok.padding_side = "right"
    torch.manual_seed(0)
    enc = AutoModel.from_config(LlamaConfig(vocab_size=len(tok), hidden_size=HIDDEN, intermediate_size=64, num_hidden_layers=2, num_attention_heads=2,
                                            num_key_value_heads=2, max_position_embeddings=4096)).eval()
    kw = {"width": 24, "depth": 3, "proj": PROJ, "hidden": HIDDEN, "layernorm": True}
    sh, ah = make_head(**kw), make_head(**kw)
    path = tmp_path_factory.mktemp("ck") / "heads.pt"
    torch.save({"state_head": sh.state_dict(), "action_head": ah.state_dict(), "logit_scale": torch.tensor(4.6), "projection_dim": PROJ,
                "cfg": {"width": 24, "depth": 3, "layernorm": True, "hidden_size": HIDDEN}}, path)
    lsh, lah, scale, cfg = load_heads(str(path), "cpu")
    assert cfg["width"] == 24 and 99 < scale <= 100
    return CLMEngine(enc, tok, lsh, lah, scale, "cpu", max_tokens=64, batch_tokens=256, model_id="tiny")


REQ = {"model": "x", "state": {"ticket": "Charged twice for one order", "amount": 45}, "questions": {
    "c": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "Charges and refunds", "tech": ""}},
    "s": {"type": "score", "instructions": "How angry?", "criteria": ["calm", "annoyed", "furious"]},
    "n": {"type": "noul", "instructions": "Is a refund due?"}}}


def test_text_rendering_matches_reference_scheme():
    assert to_text({"a": 1, "b": {"c": [1, 2]}}) == "a: 1\n\nb:\n  c:\n    - 1\n    - 2"
    assert state_text("ctx", "Q?") == "ctx\n\nQ?" and state_text("", "Q?") == "Q?"
    assert candidate_texts("choice", {"a": "desc", "b": ""}, "q") == ["desc", "b"]
    assert candidate_texts("noul", None, "Is it late?") == ["false: No. This is false: Is it late?", "true: Yes. This is true: Is it late?"]
    assert candidate_texts("score", ["x", "y"], "q") == ["x", "y"]


def test_answers_are_distributions(engine):
    a = engine.predict_sync(SystemOneRequest(REQ))["answers"]
    assert abs(sum(a["c"]["probabilities"].values()) - 1) < 1e-5 and set(a["c"]["probabilities"]) == {"billing", "tech"}
    assert set(a["s"]["probabilities"]) == {"0", "1", "2"} and 0 <= a["n"]["noul"] <= 1


def test_batched_embedding_equals_single_and_is_cached(engine):
    texts = ["short", "a much longer piece of text " * 3, "medium length text here"]
    engine.cache.clear()
    batched = engine.embed(texts)
    assert all(t in engine.cache for t in texts) and abs(float(batched[0].norm()) - 1) < 1e-5
    for t, b in zip(texts, batched, strict=True):
        engine.cache.clear()
        assert torch.allclose(engine.embed([t])[0], b, atol=1e-4)  # right padding is exact for a causal encoder


def test_left_truncation_keeps_the_question(engine):
    long_state = "filler " * 200
    a = engine.embed([long_state + "FINAL QUESTION"])[0]
    b = engine.embed(["x " + long_state + "FINAL QUESTION"])[0]  # differs only in the part that gets cut off
    assert torch.allclose(a, b, atol=1e-4)


def test_async_path_and_determinism(engine):
    r1 = engine.predict_sync(SystemOneRequest(REQ))
    r2 = asyncio.run(engine.predict_async(SystemOneRequest(REQ)))
    assert r1["answers"]["c"]["probabilities"] == r2["answers"]["c"]["probabilities"] and r2["x_decida"]["prompt_version"] == "clm-reference-v0"
