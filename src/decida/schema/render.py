import unicodedata
from typing import Any

import orjson


def render_criterion(val: Any) -> str:
    """Render a criteria value as the text the encoder reads: strings as they are, structured values as compact JSON."""
    if isinstance(val, str):
        return unicodedata.normalize("NFC", val)
    # object/array rendered as compact JSON, key order preserved
    return orjson.dumps(val).decode("utf-8")
