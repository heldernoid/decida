"""The encoder layout shares a small token budget across all options; truncation must be visible and configurable."""
from pathlib import Path

import pytest
from _tokenizer import tokenizer_dir

from decida.model.enc import LayaLayout
from decida.schema.models import CaseQuestion
from decida.schema.primitives import Primitive

TOK_DIR = Path(tokenizer_dir() or "/nonexistent")
pytestmark = pytest.mark.skipif(not TOK_DIR.exists(), reason="the DecidaBERT-large tokenizer is not available")


@pytest.fixture(scope="module")
def tokenizer():
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(str(TOK_DIR))


def question(n: int, words: int) -> CaseQuestion:
    text = " ".join(f"word{i}" for i in range(words))
    return CaseQuestion(qid="q", primitive=Primitive.CHOICE, instructions="Where should the piece go?",
                        criteria={f"opt{i}": f"{text} Best." for i in range(n)})


def test_few_short_options_are_not_cut(tokenizer):
    enc = LayaLayout(tokenizer).build("state", question(3, 5))
    assert enc.options_truncated == 0


def test_many_long_options_are_cut_with_the_default_budget(tokenizer):
    enc = LayaLayout(tokenizer).build("state", question(34, 30))
    assert enc.options_truncated == 34
    assert len(enc.readout_positions) == 34  # every option still has its marker


def test_the_tail_of_a_long_option_is_lost_by_default_and_kept_when_widened(tokenizer):
    q = question(20, 25)
    narrow = LayaLayout(tokenizer).build("state", q)
    wide = LayaLayout(tokenizer, max_len=4096, head_max_len=4000, opt_max_tokens=96).build("state", q)
    assert "Best" not in tokenizer.decode(narrow.input_ids)
    assert tokenizer.decode(wide.input_ids).count("Best") == 20
    assert wide.options_truncated == 0 and narrow.options_truncated == 20


def test_state_truncation_is_reported(tokenizer):
    enc = LayaLayout(tokenizer).build("word " * 2000, question(2, 3))
    assert enc.truncated is True
