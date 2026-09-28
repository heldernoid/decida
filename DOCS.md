# Decida documentation

Every `decida` command in depth, with examples, plus the models, the REST API, the testbench, results, settings
and everything else that did not fit in a short README. See [README.md](README.md) for install and a two-minute
start, and [MCP.md](MCP.md) for the MCP server. `decida help` (or `decida --help`) prints the same command list
from the CLI itself; `decida <command> --help` prints that command's full flag list.

## Commands

### `decida serve`

Start the HTTP API server.

```bash
decida serve                                                                              # the models in ~/.decida/settings.json
decida serve --model decidabert=helmo/DecidaBERT-large --model qwen=helmo/Qwen3-0.6B       # or serve exactly these
decida serve -m decidabert=helmo/DecidaBERT-large --port 8010 --device cpu                 # short flag, explicit port and device
```

- `--model`/`-m` (repeatable): `username/model-id`, `username/model-id:folder`, a local folder, or a hosted URL, optionally `alias=ref`. Leave out entirely to serve the settings.json list. Passing any `--model` **never writes `~/.decida/settings.json`**.
- `--device`, `--host`, `--port`: override the settings.json values for this run only.
- `--backend`: force `encoder | lm | clm | gliner | remote` instead of auto-detecting (`decida detect` shows what auto-detection would pick).
- `--dtype`: `auto | float32 | bfloat16 | float16`, for the `lm`/`clm` backends.
- `--lazy`/`--no-lazy`: load each model on its first request instead of at startup. Default: settings.json's own value when serving that list, off otherwise. `--no-lazy` downloads **and loads** every configured model before the server accepts requests. Only use it if you have the RAM/VRAM for all of them at once, since Decida does not check that a model fits before loading it.
- `--head-tokens`, `--option-tokens`, `--max-len`: encoder-backend token budgets (0 keeps the model's trained defaults).
- `--remote-budget-usd`, `--remote-price-per-m`, `--remote-key-env`: hosted-model spend controls (see "Hosted models" below).

**Which model is the default** (used when a request omits `model`, or an MCP tool call): whichever one registers first, which is the first entry in the `--model` list, or the first entry in `settings.json` when none is given. Change it with `decida setup --default <alias>` rather than reordering flags by hand.

**Finding a running server**: on startup, `decida serve` writes `~/.decida/running.json` (host, port, pid). This is how `decida mcp` finds it automatically without `DECIDA_URL` (see MCP.md), and how `decida ps`'s default URL could be extended to do the same later.

### `decida setup`

Choose which models Decida serves: an interactive menu, or scriptable flags. Saved to `~/.decida/settings.json`.

```bash
decida setup                                    # interactive: add/remove/make-default/reset/port/lazy
decida setup --add someone/some-model            # add one (checks the Hub first; use --no-check offline)
decida setup --add mymodel=someone/some-model    # add with a chosen alias
decida setup --remove qwen                       # remove by alias
decida setup --remove 3                          # or by its 1-based number in the list
decida setup --default qwen                      # move a model to the front: it becomes decida serve's default
decida setup --reset                             # restore the shipped default model list
decida setup --list                              # show the list and exit (marks the current default)
decida setup --path                              # print the settings file location and exit
```

Flags can combine in one call (`decida setup --remove jev --add someone/x --default someone/x`) and are applied in that order: reset, then removes, then adds, then default. The interactive menu (no flags) offers the same actions plus port and lazy-loading.

### `decida list`

Models in `settings.json` and whether each is downloaded. **No server, no network call**: it reads the local Hugging Face cache directly.

```bash
$ decida list
NAME                  ID            SIZE      MODIFIED     REF
decidabert            d8b57a4b4ca7  1.6 GB    1 day ago    helmo/DecidaBERT-large
qwen                  429540cff6ef  1.4 GB    1 day ago    helmo/Qwen3-0.6B
jev                   -             -         hosted       https://api.typesafe.ai/v1/systemone?model=jev-latest
```

`ID` is the cached snapshot's short commit hash; `SIZE` is the actual on-disk size for that alias (computed per-folder for a repo like `helmo/laya` that holds several checkpoints, not the whole repo's total); a model not yet downloaded shows `-`/`-` with the reason (`not downloaded`/`local`/`hosted`) under `MODIFIED`.

### `decida ps`

Models loaded by a **running** `decida serve`, the ollama-style counterpart to `list`.

```bash
$ decida ps
   NAME        BACKEND  STATUS  DEVICE  MODE                  REF
*  decidabert  encoder  ready   mps     specialist            helmo/DecidaBERT-large
   qwen        lm       ready   mps     zero-shot             Qwen/Qwen3-0.6B
   jev         remote   ready   mps     hosted (third-party)  https://api.typesafe.ai/v1/systemone?model=jev-latest
```

`*` marks the default model. `--url` points at a server on a non-default host/port: `decida ps --url http://127.0.0.1:8010`.

### `decida pull`

Download models to the Hugging Face cache **without loading them into RAM or VRAM**. Handy on a slow link, or before going offline. Re-running it on an already-cached model is a fast no-op, so it also doubles as an "is this downloaded?" check.

```bash
decida pull                                          # every local model in settings.json
decida pull helmo/DecidaBERT-large helmo/Qwen3-0.6B  # only these
decida pull mymodel=someone/some-model               # an ad-hoc ref not in settings.json at all
```

This never touches `settings.json`. Pulling a model does not by itself make `decida serve` serve it; the command prints the exact next step (`decida serve --model ...` or `decida setup --add ...`) for anything it pulled that wasn't already configured.

### `decida detect`

Show which backend would serve a model, and why. **Reads file names and small config files only**: no weights downloaded, no code from the repo executed.

```bash
$ decida detect helmo/laya:typed-decisions
{
  "backend": "encoder",
  "reason": "rl_agent_config.json present (Decida/Laya encoder checkpoint)",
  "ref": "helmo/laya:typed-decisions",
  "quality_mode": "specialist",
  "calibrated": true,
  "license": "apache-2.0"
}
```

### `decida check`

Load a model and run the 14 wiring smoke checks (plus a few math-consistency checks). Exit code 1 if anything is broken.

```bash
decida check helmo/Qwen3-0.6B
decida check helmo/DecidaBERT-large --device cuda --verbose   # print each individual check
```

`--backend` forces a backend instead of auto-detecting, same as `serve`'s flag.

### `decida predict`

One prediction, entirely local, no server: two JSON files in, one JSON response out.

```bash
decida predict --model helmo/DecidaBERT-large --state state.json --questions questions.json
```

`state.json` holds the raw JSON value for `state` (a string or an object); `questions.json` holds the `questions` map exactly as `/v1/systemone` expects it.

### `decida data`

Whether a bench's dataset is on disk, or download it (verified against a pinned SHA-256).

```bash
decida data status wikispeedia
decida data download wikispeedia   # about 840 MB
```

### `decida mcp`

Runs the MCP stdio server. See [MCP.md](MCP.md): it's not an interactive command (it blocks on stdin waiting for an MCP client), covers how to try it including a browser UI with no client config, and documents every tool with examples.

### `decida help` / `decida --help` / `decida --version`

`decida help` and a bare `decida` both print the full command list; `decida <command> --help` prints one command's flags in full. `decida --version` prints the installed version.

## The models it ships with

| alias | model | what it is | licence |
|---|---|---|---|
| `decidabert` | [helmo/DecidaBERT-large](https://huggingface.co/helmo/DecidaBERT-large) | Decida's own 421M parameter encoder, trained for typed decisions | Apache-2.0 |
| `laya-typed-decisions` | `helmo/laya:typed-decisions` | Laya's typed-decisions checkpoint | Apache-2.0 |
| `laya` | `helmo/laya` | Laya, English checkpoint | Apache-2.0 |
| `laya-multilingual` | `helmo/laya:multilingual` | Laya, multilingual checkpoint | Apache-2.0 |
| `qwen` | [helmo/Qwen3-0.6B](https://huggingface.co/helmo/Qwen3-0.6B) | a general language model, read zero-shot through option letters | Apache-2.0 |
| `gliner-decide` | [helmo/GLiNER2.5-Decide](https://huggingface.co/helmo/GLiNER2.5-Decide) | a DeBERTa-v3-large classifier, read zero-shot | Apache-2.0 |
| `gliner-multi-decide` | [helmo/GLiNER2.5-multi-Decide](https://huggingface.co/helmo/GLiNER2.5-multi-Decide) | a smaller multilingual classifier, read zero-shot | Apache-2.0 |
| `jev` | TypeSafe Jev (hosted) | a hosted model, used as a reference; see "Hosted models" below | TypeSafe's terms |

`helmo/laya`, `helmo/Qwen3-0.6B`, `helmo/GLiNER2.5-Decide` and `helmo/GLiNER2.5-multi-Decide` are unmodified copies of [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya), [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) and Fastino AI's [GLiNER2.5-Decide](https://huggingface.co/fastino/GLiNER2.5-Decide) / [GLiNER2.5-multi-Decide](https://huggingface.co/fastino/GLiNER2.5-multi-Decide), kept as a backup so they can always be downloaded. Each copy has a `MIRROR.md` with the original commit and file hashes. The GLiNER checkpoints are read directly with `transformers`/`torch` (Decida's own prompt layout and classifier head), not through the `gliner2` package. Any Hugging Face model can be added: Decida detects whether it is an encoder checkpoint, a causal language model, a Contrastive-LM checkpoint, or a GLiNER2 classifier, and `username/model-id:folder` picks one checkpoint out of a repository that holds several.

## Using the REST API

```bash
curl -s localhost:8000/v1/systemone -H 'content-type: application/json' -d '{
  "model": "decidabert",
  "state": "Customer: I was billed twice for March and want my money back.",
  "questions": {
    "team": {"type": "choice", "instructions": "Which team should handle this?",
             "criteria": {"billing": "Charges, invoices, refunds",
                          "technical": "Bugs and outages",
                          "sales": "Pricing, demos, new seats"}},
    "urgent": {"type": "noul", "instructions": "Is this urgent?"}
  }}'
```

| endpoint | purpose |
|---|---|
| `POST /v1/systemone` | one state and its questions, answered in one pass |
| `POST /v1/systemone/batch` | up to 256 independent requests in one call, answered concurrently |
| `GET /v1/models`, `POST /v1/models`, `DELETE /v1/models/{name}` | list, add or unload a model |
| `POST /v1/check` | the 14 smoke checks against a loaded model |
| `GET /v1/device`, `GET /metrics`, `GET /health` | device and memory, latency percentiles, liveness |
| `GET /v1/datasets`, `POST /v1/datasets/{id}/download` | the data the benches use |

The MCP server (`decida mcp`) gives a coding agent `gate_tool_call`, `vet_dependency`, `triage_failure`, `classify_text` and a raw `decide` tool. See [MCP.md](MCP.md).

## The testbench

Open the **Testbench** page of a running server. Each bench is a static page that talks only to the public API and shows every decision, its distribution and its latency.

| bench | what it tests |
|---|---|
| T-Rex runner, Snake, Flappy, Tetris | real-time games where the model chooses every few frames, with an exact oracle to score each choice |
| Candies sorter | one small question per candy, 256 per request, sorted into five bowls |
| Inbox | 100 emails, 25 spam, filed by one batched yes/no question each; a suspicious-looking link is disabled regardless of what the model said |
| Colour palette, Emoji finder | how well a model matches a phrase to colours or emoji, including whether it knows a country's flag or a brand's colours |
| Wikispeedia | click through real articles, with images, from a start page to a goal page; compared with recorded human averages |
| AI Town | one announcement, fifty citizens, each deciding what to do, with a stopwatch over the whole town |
| Live fraud gate | card transactions arrive one at a time; the correct call is computed from each transaction's own fields, not hand-labelled, and misses are split from over-caution instead of one accuracy figure |
| News trading | wire headlines and a social-media reaction arrive one at a time; buy, hold or sell against the conventional, textbook-expected direction for that kind of news |
| Model compare | the same questions to several models side by side, plus a hand-written labelled set that scores accuracy, confidence and latency |

The Candies sorter and AI Town ideas come from Matthew Berman's video "We need to talk about Jev...", the colour palette from Matt DesLauriers and the emoji finder from Stefan (@heystefan_). Inbox, Live fraud gate and News trading are original. None of the credited ones published code; the designs and implementations here are our own. See `THIRD_PARTY.md`.

## Results

[DecidaBERT-large](https://huggingface.co/helmo/DecidaBERT-large) on the 400 held-out cases (2,000 questions) of [LocalLLaMA/typed-decisions](https://huggingface.co/datasets/LocalLLaMA/typed-decisions), scored by top-answer accuracy. It was trained on that benchmark's training split, so this is a **specialist** result.

| model | overall | choice | score | yes/no |
|---|---|---|---|---|
| DecidaBERT-large | **0.743** (95% interval 0.723 to 0.762) | 0.722 | 0.694 | 0.830 |
| Laya, typed-decisions checkpoint | 0.761 | 0.738 | 0.715 | 0.847 |
| Qwen3-0.6B, zero-shot | 0.383 | 0.350 | 0.281 | 0.550 |

We do not claim that DecidaBERT-large beats any other model: Laya's specialist checkpoint scores higher, and the benchmark's labels are noisy. The model card lists what was measured, how, and what was not. The scoring script is `eval_typed_decisions.py` in the [model repository](https://huggingface.co/helmo/DecidaBERT-large).

## Hosted models

Decida can forward requests to a hosted System One endpoint, listed by its URL. It is meant for benchmarking and comparison, and it is off unless you set an API key. `jev` is one of the default models, so it needs no setup beyond the key; to add a hosted model by hand instead, pass its URL like any other reference:

```bash
export TYPESAFE_API_KEY=sk-...
decida serve --model jev="https://api.typesafe.ai/v1/systemone?model=jev-latest"
```

- A URL is detected as a hosted model automatically; no `--backend` flag is needed. Quote it, since it contains a `?`.
- The key is read from the environment variable named in the settings (`TYPESAFE_API_KEY` by default) and is **never written to disk or logged**.
- Spend is estimated from token counts and **capped** (`$1` by default, `--remote-budget-usd`). Requests stop when the cap is reached.
- Use of a hosted service is under its own terms. Do not use a hosted model's outputs as training data.

Decida is an independent project and is not affiliated with TypeSafe, Convai Innovations or any other model author.

## Settings, data and devices

- `~/.decida/settings.json` holds the model list and server options (`DECIDA_HOME` moves it). It holds no secrets.
- `~/.decida/running.json` records which host:port the most recently started `decida serve` is bound to (see `decida mcp` above and MCP.md).
- Bench datasets go to `~/.decida/datasets/` (`DECIDA_DATA_DIR` overrides it). Model weights stay in Hugging Face's own cache.
- The device is chosen as CUDA (AMD via ROCm uses this path; see "AMD GPU" below), then Apple GPU (MPS), then CPU, and `--device` overrides it. Encoder models run in float32. On an Apple GPU models take turns, because PyTorch's Metal backend is not thread safe.
- Decida does not check that a model fits before loading it, and it does not unload models by itself. The Models page has an Unload button, and `decida setup` removes models from the list.

## Writing questions that work

What the testbench showed, model after model: put the state in words and never in raw numbers; ask what the text says, not what to do; describe every option, because the option text is what the model matches against; keep option lists short and only offer options that are reachable; and let your own code do the measuring and choosing, using the model for perception questions. Watch `x_decida.truncation` in the response to see whether any text was cut.

## Development

```bash
uv sync --all-extras          # or: make setup
make test                     # pytest and the JavaScript tests (node --test)
make lint                     # ruff and pyright
```

The tests that need a tokenizer fetch the small tokenizer files of `helmo/DecidaBERT-large` from the Hub (cached), or read a folder named in `DECIDA_TEST_TOKENIZER`. Decida runs models; it does not train them or generate data. The code is under `src/decida/`: `runtime/` (detecting, loading and locating models), `serve/` (the engines and the API), `model/` (the encoder), `schema/` (the typed questions and answers), and `web/` (the home page and the benches).

## AMD GPU (ROCm)

Tested on AMD Ryzen AI Max+ 395 (Radeon 8060S, gfx1151, Strix Halo APU) with Ubuntu and ROCm 10.0. DecidaBERT-large: ~43 ms per request on the AMD GPU vs ~370 ms on the same box's CPU (n=3 warm runs, 2 questions each).

AMD's ROCm stack maps `torch.cuda.*` calls to the AMD GPU through HIP, so Decida's CUDA path handles AMD without code changes. The standard install resolves `torch` to a CUDA-only wheel; use **AMD's own index** (`stable.repo.amd.com/rocm/whl-next/`): it ships gfx1151-specific kernels and does not have the Strix Halo segfault in the PyTorch-distributed ROCm 7.1/7.2 wheels. The short version of the global-install step is in the README; here is the full picture.

**Global install (`uv tool install`):**

```bash
uv tool install git+https://github.com/heldernoid/decida
uv pip install --no-config --python "$(uv tool dir)/decida/bin/python" \
  --index-url https://stable.repo.amd.com/rocm/whl-next/ \
  "torch==2.12.0+rocm10.0.0" "amd-torch-device-gfx1151"
```

Replace `gfx1151` with your GPU's architecture (`rocminfo | grep "Name:.*gfx"` to find it). `uv tool upgrade decida` reinstalls the CUDA-only wheel; rerun the `uv pip install` line after each upgrade.

**Development install (`uv sync`):**

```bash
# Step 1: sync without the CUDA-only packages
uv sync --frozen \
  --no-install-package torch --no-install-package triton --no-install-package cuda-bindings \
  --no-install-package nvidia-cublas --no-install-package nvidia-cuda-cupti \
  --no-install-package nvidia-cuda-nvrtc --no-install-package nvidia-cuda-runtime \
  --no-install-package nvidia-cudnn-cu13 --no-install-package nvidia-cufft \
  --no-install-package nvidia-cufile --no-install-package nvidia-curand \
  --no-install-package nvidia-cusolver --no-install-package nvidia-cusparse \
  --no-install-package nvidia-cusparselt-cu13 --no-install-package nvidia-nccl-cu13 \
  --no-install-package nvidia-nvjitlink --no-install-package nvidia-nvshmem-cu13 \
  --no-install-package nvidia-nvtx

# Step 2: install the AMD ROCm 10 wheel (--no-config bypasses the project's exclude-newer pin)
uv pip install --no-config \
  --index-url https://stable.repo.amd.com/rocm/whl-next/ \
  "torch==2.12.0+rocm10.0.0" "amd-torch-device-gfx1151"
```

If `uv.lock` has drifted and step 1 reinstalls excluded packages, regenerate the exclude list:
```bash
python3 -c "import tomllib; print([p['name'] for p in tomllib.load(open('uv.lock','rb'))['package'] if p['name'].startswith('nvidia-') or p['name'] in ('triton','cuda-bindings')])"
```

**`uv run` re-syncs before every command and will silently reinstall the CUDA-only wheel.** Use `--no-sync` for all commands after step 2:

```bash
uv run --no-sync python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
uv run --no-sync decida serve
uv run --no-sync decida check helmo/DecidaBERT-large --device cuda
```

Do not edit `pyproject.toml`'s torch dependency to point at an AMD index: that would break every non-AMD Linux user and CI.

## Limitations

- Encoder models match the state against the options you give. They have little world knowledge, so tasks that need facts (for example, which page mentions which) suit larger models better.
- Only English has been tested. Small models read text well but are weak at telling one person's reaction from another's; the AI Town bench shows this and says which mode it ran.
- Testing focused solely on Apple Silicon (Apple GPU through MPS) and AMD (Radeon 8060S via ROCm 10). CUDA on NVIDIA hardware is wired up but untested.
