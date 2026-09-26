"""Where the tests find the DecidaBERT-large tokenizer (a few MB of files, no weights).

In order: a folder named in $DECIDA_TEST_TOKENIZER, then the published model `helmo/DecidaBERT-large` on the Hugging Face Hub (only the
tokenizer files, cached after the first download). None if both fail, and the tests that need it skip.
"""
import os
from pathlib import Path


def tokenizer_dir() -> str | None:
    env = os.environ.get("DECIDA_TEST_TOKENIZER")
    if env and (Path(env) / "tokenizer.json").exists():
        return env
    try:
        from huggingface_hub import snapshot_download
        return snapshot_download("helmo/DecidaBERT-large", allow_patterns=["tokenizer*.json"])
    except Exception:  # noqa: BLE001  offline or the Hub is unreachable: any failure just means the tests that need it skip
        return None
