# AGENTS.md: rules for coding agents working on Decida

Read this file before any task. It overrides habits and defaults.

## 1. What Decida is

Decida is a **runtime for System One (decision) models**: it loads models from Hugging Face, serves typed questions (`choice`, `score`, `noul`) over REST and MCP, and ships a testbench of games and tools for judging model behaviour. A request is a state plus typed questions, and the answer is a probability distribution per question, computed in one forward pass with no generated text.

**Out of scope:** training models, generating datasets, and any use of hosted-model outputs as data. If a task seems to need one of these, stop and ask.

**Orientation.** `README.md`'s Development section maps the source tree; read it before searching blind. For local work, `decida pull <ref>` fetches a model's weights without loading them (no RAM or VRAM used), and `decida serve --model alias=ref` serves only the one or two models you are actually changing, instead of everything in `~/.decida/settings.json`.

## 2. Hard constraints

1. **Secrets live only in environment variables** (`HF_TOKEN`, `TYPESAFE_API_KEY`). Never write one to a file, a log, an error message, a config, a cache key or a test fixture. `RemoteEngine` scrubs the key from errors; keep it that way.
2. **Hosted models are opt-in and capped.** They are reached only through `RemoteEngine`, need their key in the environment, stop at a spend cap (default 1 USD), and are never used to create labels, training data or calibration data. Use of a hosted service is under its own terms.
3. **Licences come first.** Code, data or models adopted from elsewhere need a compatible licence, an entry in `THIRD_PARTY.md`, and their licence text in `third_party/licenses/`. If a licence is unclear, ask. Ideas taken from someone's public demo are credited on the page and in `THIRD_PARTY.md`, even when no code was used.
4. **No real personal data.** Test data, fixtures and bench data are synthetic or from licensed public datasets. Datasets are downloaded at run time (see `src/decida/datasets.py`: pinned size and SHA-256), never committed.
5. **No weights, data or large artifacts in git.**
6. **Do not claim what you did not measure.** Any number in a README, model card or page comes from a measurement you can name, with its sample size. Label results as *specialist* (trained on that benchmark's training split) or *generalist*, and never compare across modes. Do not write "better than X" unless a like-for-like measurement proves it.
7. **Test sets are never used** to train, tune, calibrate or choose a checkpoint.

## 3. Working agreement

1. **Read before you write.** Search the repository for an existing helper before creating one. Never keep two implementations of the same thing.
2. **Plan before code** for anything larger than about 100 lines: which files, which interfaces, which tests.
3. **Tests ship with the code.** Every public function is covered. Anything random has a determinism test (explicit seed, no global RNG, no `hash()`; use `hashlib`).
4. **Small commits**, one logical change each, in the form `area: imperative summary` (for example `runtime: load encoder models from the Hub`).
5. **Ask before deciding** when: a licence is unclear, a spend above the cap is needed, a change would break the public API or the wire format, or two documents disagree.
6. **Report outcomes faithfully.** If a test fails or a step was skipped, say so with the output.

## 4. Engineering rules

- Python 3.11 or newer, `uv`, `ruff`, `pyright`, `pytest`. All must pass before a change is done: `make lint`, `make test`.
- **Type everything.** Public functions have type hints, and data crossing a module boundary is a pydantic model. The typed modules (`schema/`, `settings.py`, `datasets.py`) are checked in pyright strict mode.
- **Names come from enums.** Use `Primitive.CHOICE`, `Primitive.SCORE`, `Primitive.NOUL`; the raw strings belong only to the schema layer and the wire format.
- **Library code logs, it does not print.** Use the `logging` module. Only the CLI prints, and it uses `typer.echo`.
- **One place for each thing.** Model references and Hub downloads go through `runtime/refs.py`; datasets through `datasets.py`; settings through `settings.py`; GPU work takes the lock from `runtime/device.py` (PyTorch's Apple GPU backend crashes when two models run at once).
- **New dependencies** need a one-line justification and a licence check, and should be releases at least 14 days old; `pyproject.toml`'s `[tool.uv] exclude-newer` pin enforces this at lock time, so move that date forward (never remove it) when you add or upgrade one. Do not add a package for something the standard library does.
- **Comments say why, not history.** No notes about how something was arrived at, and no references to files that are not in the repository.

## 5. The testbench (`src/decida/web/bench/`)

- A bench is a folder with an `index.html` and an optional `bench.json`. It is a static page that talks only to the public API; the server lists it automatically.
- Game and scoring logic lives in a plain `.js` module with **no DOM access**, tested with `node --test` in `tests/js/`. The page only draws and wires it up.
- **State in words, never in raw numbers; ask what the text says, not what to do; describe every option; keep option lists short; let code do the measuring and choosing.** Rotate option order to cancel position bias when a model needs it.
- Show what the model was actually sent, and surface `x_decida.truncation` so a cut is never silent.
- **`node --test` does not see the page.** It checks the logic module, not layout, spacing or a hard-coded starting state. Before calling a UI change done, load the changed page in a browser (or `--headless=new --screenshot=...` if none is open) and look at it; several real bugs here (an overlapping column, a step that always opened on the wrong tab, a broken favicon tag) passed every automated check.
- Benches that use someone else's idea credit them on the page and in `THIRD_PARTY.md`.
- Keep controls few. Put anything most people should not touch behind an "Advanced" section, with a sensible default.

## 6. Definition of done

- [ ] `make lint` (ruff and pyright) and `make test` (pytest and the JavaScript tests) pass.
- [ ] New behaviour has tests, including the failure cases.
- [ ] The relevant command works from a fresh install (`uv tool install .`, then `decida <command> --help`).
- [ ] README and the home page match what the code does. No documented command that does not exist.
- [ ] Any number quoted anywhere has a source in a measurement, with `n`.
- [ ] Licence and attribution are in place for everything adopted.
