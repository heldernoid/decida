"""Runs the JavaScript bench tests (game logic) with node; skipped when node is not installed."""
import shutil
import subprocess
from pathlib import Path

import pytest
from _tokenizer import tokenizer_dir

JS_DIR = Path(__file__).parent / "js"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_js_bench_logic():
    r = subprocess.run(["node", "--test", *sorted(str(p) for p in JS_DIR.glob("*.test.mjs"))], capture_output=True, text=True, timeout=300, check=False)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-1000:]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_live_tetris_requests_fit_the_encoder_token_budget():
    """The encoder shares 192 tokens across the instructions and ALL options (48 per option), and serving allows 2048 tokens in
    total. If live-Tetris text grows past either, small models silently see truncated options or a cut state."""
    import json

    tok_dir = Path(tokenizer_dir() or "/nonexistent")
    if not tok_dir.exists():
        pytest.skip("the DecidaBERT-large tokenizer is not available")
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(str(tok_dir))
    out = subprocess.run(["node", str(JS_DIR / "dump_live_requests.mjs")], capture_output=True, text=True, timeout=120, check=True).stdout
    reqs = json.loads(out)
    assert len(reqs) > 200
    for r in reqs:
        q = r["questions"]["move"]
        lens = [len(tok(" " + v, add_special_tokens=False)["input_ids"]) + 1 for v in q["criteria"].values()]
        assert max(lens) - 1 <= 48, f"option too long: {max(lens) - 1} tokens"
        assert 192 - sum(lens) >= 16, f"options use {sum(lens)} of 192 head tokens (per-option truncation would start)"
        state = len(tok(r["state"], add_special_tokens=False)["input_ids"])
        head = len(tok("choice question: " + q["instructions"], add_special_tokens=False)["input_ids"])
        assert head + sum(lens) + state + 3 <= 2048, f"sequence of {head + sum(lens) + state + 3} tokens exceeds the 2048 served"
