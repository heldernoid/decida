"""Decida's settings file: which models to serve and how, kept in `~/.decida/settings.json` (or `$DECIDA_HOME/settings.json`).

`decida setup` edits it and `decida serve` reads it, so nobody has to retype a long command. The file holds no secrets: a hosted model
is listed by its URL and its API key is read from an environment variable (`TYPESAFE_API_KEY` by default).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator, model_validator

from decida.runtime.refs import alias_for, is_url

SETTINGS_VERSION = 1
_ALIAS = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
HOSTED_URL = "https://api.typesafe.ai/v1/systemone?model=jev-latest"


class SettingsError(ValueError):
    """The settings file is unreadable or a change to it is not allowed; the message says what to do."""


class ModelSpec(BaseModel):
    alias: str
    ref: str
    note: str = ""

    @field_validator("alias")
    @classmethod
    def _alias_ok(cls, v: str) -> str:
        if not _ALIAS.match(v):
            raise ValueError(f"alias {v!r} must be lower case letters, digits, '.', '_' or '-', starting with a letter or digit")
        return v

    @field_validator("ref")
    @classmethod
    def _ref_ok(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("a model needs a reference: username/model-id, a local folder, or a hosted URL")
        return v

    @property
    def hosted(self) -> bool:
        return is_url(self.ref)


class ServerSettings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    device: str = "auto"              # auto | cuda | mps | cpu
    lazy: bool = True                 # load each model on its first request instead of at startup
    max_len: int = Field(default=2048, ge=0)          # encoder models: total tokens including the state (0 keeps the model's own default)
    head_tokens: int = Field(default=1400, ge=0)      # encoder models: tokens shared by the instructions and all options (0 keeps 192)
    option_tokens: int = Field(default=160, ge=0)     # encoder models: tokens per option (0 keeps 48)


class HostedSettings(BaseModel):
    key_env: str = "TYPESAFE_API_KEY"         # the environment variable that holds the API key; the key itself is never stored
    budget_usd: float = Field(default=1.0, ge=0)      # requests to hosted models stop once this much has been spent (estimated)
    price_per_m_input: float = Field(default=0.042, ge=0)


class Settings(BaseModel):
    version: int = SETTINGS_VERSION
    models: list[ModelSpec]
    server: ServerSettings = Field(default_factory=ServerSettings)
    hosted: HostedSettings = Field(default_factory=HostedSettings)

    @model_validator(mode="after")
    def _unique_aliases(self) -> Settings:
        seen: set[str] = set()
        for m in self.models:
            if m.alias in seen:
                raise ValueError(f"the alias {m.alias!r} is used twice")
            seen.add(m.alias)
        return self


def default_models() -> list[ModelSpec]:
    """The models Decida ships with: copies kept under helmo/ so they can always be downloaded, plus the hosted reference model."""
    return [
        ModelSpec(alias="decidabert", ref="helmo/DecidaBERT-large", note="Decida's own model, trained for typed decisions"),
        ModelSpec(alias="laya-typed-decisions", ref="helmo/laya:typed-decisions", note="Laya, the typed-decisions checkpoint"),
        ModelSpec(alias="laya", ref="helmo/laya", note="Laya, English checkpoint"),
        ModelSpec(alias="laya-multilingual", ref="helmo/laya:multilingual", note="Laya, multilingual checkpoint"),
        ModelSpec(alias="qwen", ref="helmo/Qwen3-0.6B", note="Qwen3-0.6B, a general language model read zero-shot"),
        ModelSpec(alias="gliner-decide", ref="helmo/GLiNER2.5-Decide", note="GLiNER2.5-Decide, DeBERTa-v3-large, read zero-shot"),
        ModelSpec(alias="gliner-multi-decide", ref="helmo/GLiNER2.5-multi-Decide", note="GLiNER2.5-multi-Decide, multilingual, read zero-shot"),
        ModelSpec(alias="jev", ref=HOSTED_URL, note="TypeSafe Jev, hosted; needs TYPESAFE_API_KEY and is capped by the spend limit"),
    ]


def default_settings() -> Settings:
    return Settings(models=default_models())


def home() -> Path:
    return Path(os.environ.get("DECIDA_HOME") or Path.home() / ".decida").expanduser()


def path() -> Path:
    return home() / "settings.json"


def load(create: bool = True) -> tuple[Settings, bool]:
    """The settings, and whether the file was just created with the defaults. A damaged file is reported, never overwritten."""
    f = path()
    if not f.exists():
        s = default_settings()
        if create:
            save(s)
        return s, create
    try:
        return Settings.model_validate(json.loads(f.read_text(encoding="utf-8"))), False
    except (json.JSONDecodeError, ValueError) as exc:
        raise SettingsError(f"{f} could not be read ({exc}). Fix it by hand, or move it aside and run `decida setup` to start again.") from exc


def save(s: Settings) -> Path:
    """Write the settings atomically, so a crash can never leave half a file."""
    f = path()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(s.model_dump(), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, f)
    return f


def add_model(s: Settings, ref: str, alias: str | None = None, note: str = "") -> ModelSpec:
    """Add a model. The alias defaults to a short name made from the reference; a taken alias or a repeated reference is refused."""
    ref = ref.strip()
    spec = ModelSpec(alias=(alias or alias_for(ref)).strip().lower(), ref=ref, note=note)
    if any(m.alias == spec.alias for m in s.models):
        raise SettingsError(f"there is already a model called {spec.alias!r}; choose another alias or remove it first")
    if any(m.ref == spec.ref for m in s.models):
        raise SettingsError(f"{spec.ref} is already in the list as {next(m.alias for m in s.models if m.ref == spec.ref)!r}")
    s.models.append(spec)
    return spec


def remove_model(s: Settings, alias_or_number: str) -> ModelSpec:
    """Remove a model by alias, or by its 1-based number in the list."""
    key = alias_or_number.strip().lower()
    if key.isdigit() and 1 <= int(key) <= len(s.models):
        return s.models.pop(int(key) - 1)
    for i, m in enumerate(s.models):
        if m.alias == key:
            return s.models.pop(i)
    raise SettingsError(f"no model {alias_or_number!r} in the list; the aliases are: {', '.join(m.alias for m in s.models) or 'none'}")


def serve_specs(s: Settings, environ: dict[str, str] | None = None) -> tuple[list[str], list[str]]:
    """`alias=ref` strings for the models to start, and notes about the ones left out (a hosted model without its API key)."""
    env = os.environ if environ is None else environ
    specs: list[str] = []
    notes: list[str] = []
    for m in s.models:
        if m.hosted and not env.get(s.hosted.key_env):
            notes.append(f"{m.alias} (hosted) skipped: set {s.hosted.key_env} to use it")
            continue
        specs.append(f"{m.alias}={m.ref}")
    return specs, notes
