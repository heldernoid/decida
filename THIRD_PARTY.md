# Third-party code and ideas

Code we wrote ourselves is not listed. Where Decida reuses or closely follows someone else's code, the original licence text is kept in
`third_party/licenses/` and the reuse is listed here. When code from these projects is copied into the repo (for example the testbench
games), its licence file is placed next to the copied files.

| project | licence | what we use | where in Decida |
|---|---|---|---|
| [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM) (Kwok et al.) | Apache-2.0 (`third_party/licenses/CLM-Apache-2.0.txt`) | Question rendering rules (`to_text`, `state_text`, option/noul candidate texts), the projection-head architecture and checkpoint format, and the scoring rule (scaled cosine + softmax), reimplemented on top of Hugging Face `transformers` instead of vLLM. The T-Rex benchmark runner and engine (itself from laya-vs-jev, Apache-2.0) are the reference for the testbench. | `src/decida/serve/clm_engine.py` (testbench: planned) |
| [SemIf](https://github.com/TheoLeeCJ) (TheoLeeCJ) | MIT (`third_party/licenses/SemIf-MIT.txt`) | The idea of reading a frozen causal LM's next-token logits restricted to option-letter tokens as the answer distribution. The implementation is our own; prompt, `noul`/`score` mapping and letter-token resolution differ. | `src/decida/serve/lm_engine.py` |
| [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya) (Convai Innovations) | Apache-2.0 (`third_party/licenses/Laya-NOTICE.txt`) | Checkpoint layout: `[MASK]` option markers, per-option scorer head, calibration config. Decida's encoder path is a compatible loader written from the published format; no Laya package code is vendored. The TypeSafe "System One" wire format is the request/response shape we serve. | `src/decida/model/enc.py`, `src/decida/serve/` |
| Models we evaluate (Qwen3, Qwen3.5, LFM2.5, SmolLM2, Granite, CLM-8B, Laya) | each model's own licence | Loaded from Hugging Face at run time, never redistributed. Check the model card before using outputs commercially (LFM2.5 uses the LFM Open licence; CLM-8B and Qwen3 are Apache-2.0). | `decida list` (planned) shows the licence per model |

## T-Rex runner bench (`src/decida/web/bench/dino/`)
Game constants (speed 6 to 13, gravity 0.6, jump velocity 10, obstacle gap rule) follow the public Chromium
offline-dino game (BSD-3-Clause). No Chromium code is copied; the game and planner are written from scratch.
The request format (state, "Choose the best safe action for the dinosaur.", jump/duck/run options labelled
Safe/Unsafe/Best) follows the CLM T-Rex example (Apache-2.0), which derives from laya-vs-jev (Apache-2.0).

## Live Tetris bench (`src/decida/web/bench/tetris/`: `live.js`, `index.html`) and the shared monitor panel (`bench/common/monitor.js`)
Adapted from the design of **Agent (JEV) playing Tetris** by Yasserbhb: https://github.com/Yasserbhb/Agent-JEV-Tetris
Ideas and lessons taken from it: the live falling-piece format with wall-clock gravity; a small action set (left, right,
turn, soft/hard drop, wait) whose options each carry a computed outcome preview; one best plan instead of a hint per
direction; only offering legal moves; a landing-shadow in the board text; a per-piece history summary; and the layout of
the decision panel (now shared by the Tetris, Snake and T-Rex benches via `common/monitor.js`) (probability bars, response-time chart, the exact state sent, the raw response).
The `coach` variant in `live.js` is a field-by-field port of that project's request payload (structured `rules`, `goal`, `board`, `falling_piece`,
`next_piece`, `stack`, `progress`; per-option `then_lands`, `warning`, `this_starts_the_best_plan`; ranked `priorities_in_order` and
`tie_breakers`), including its instruction wording, re-implemented in our code and adapted to a 10-column board.
Status of that repo: it has **no licence file**, so by default all rights are reserved by its author. It is used here
by the project owner's decision, with attribution, and the code in this repo is our own implementation. If the author
publishes a licence, record it here; if the author objects, remove the adapted parts.

## Candies sorter bench (`src/decida/web/bench/sorter/`)
The idea (a pile of candies sorted into five bowls by chopsticks, one small question per candy against a decision model) comes
from Matthew Berman's video "We need to talk about Jev..." (https://www.youtube.com/watch?v=2z-7pIj57f8), where it is shown running. We worked only from what the video shows;
no source code was available, and none was used. The game, the reference rule, the design and the drawing are our own.

## Colour palette and Emoji finder benches (`src/decida/web/bench/palette/`, `emoji/`)
The ideas come from two public demos shown on X: the colour bench from "does Jev understand colour?" by Matt DesLauriers
(@mattdesl, https://x.com/mattdesl/status/2100899669802963060), and the emoji finder from "when a designer gets access to Jev" by Stefan
(@heystefan_, https://x.com/heystefan_). Neither published source code, so we worked only from the videos; no code or assets from either
are used. The palette, the emoji list (written by hand), the physics, the question design and the drawing are our own.

## Ideas and code adapted from laya-playground (MIT)
Source: https://github.com/wdobry/laya-playground, MIT, Copyright (c) 2026 brain function collapse (licence text in
`third_party/licenses/laya-playground-MIT.txt`).
Adapted with attribution, re-implemented in our own code:
- **Tetris "spots" strategy** (`src/decida/web/bench/tetris/live.js`: `spotSentence`, `spotsRequest`, `pickSpot`; `index.html`): every landing
  spot is put into one sentence (holes left under the piece, the bump it makes, lines completed) and the model is asked the same binary
  question about each ("How does the stack look after the piece lands?", clean or messy); the game picks the highest P(clean) and drives
  the piece there. From `static/demos/tetris.js`, including the wording of the sentences and the two options. Ours batches all spots in one
  request and only asks about spots the piece can reach.
- **Flappy bench** (`src/decida/web/bench/flappy/`): the bird's height is put into words in five bands (far below, a little below, level with, a little
  above, far above), the question is "where is the bird relative to the gap?" with the options below / level / above, and the game flaps when
  P(below) clears a threshold. From `static/demos/flappy.js` (constants, bands, wording); the drawing and the numbers/action teaching variants are ours.
- The design lessons in their integration guide (`skills/laya-integration/SKILL.md`): put the state into words and never numbers, ask what
  the text says and not what to do, describe every option, keep option lists short, only advertise reachable targets.

## Wikispeedia bench (`src/decida/wikispeedia.py`, `src/decida/datasets.py`, `src/decida/web/bench/wikispeedia/`, `wikispeedia-eval/`)
**Data (downloaded at run time, never stored in git, never redistributed, never used for training):** Wikispeedia navigation paths, from
Stanford SNAP (https://snap.stanford.edu/data/wikispeedia.html). Article text is the 2007 Wikipedia for Schools selection (CC BY-SA 3.0 / GFDL);
the paths and link graph carry no separate licence statement, so we cite the papers: Robert West and Jure Leskovec, *Human Wayfinding in
Information Networks*, WWW 2012; Robert West, Joelle Pineau and Doina Precup, *Wikispeedia: An Online Game for Inferring Semantic Distances
between Concepts*, IJCAI 2009. Each archive is pinned by size and SHA-256 in `datasets.py`.
**Ideas:** the file layout and mission statistics (finished paths, fewest clicks, human average) follow our own earlier testbench (same author); the loader and the agent designs are rewritten. Design hints (titles-only ablation, visited
pages excluded, hubs) come from reading the LLM-WikiRace benchmark paper (arXiv 2602.16902); no code was used.

The Wikispeedia game page (`src/decida/web/bench/wikispeedia/index.html`) follows the layout of our own earlier testbench UI (mission table, custom start/goal, article with images, progress); the article HTML sanitizer (`wikispeedia_page.py`) and the page are new code.

## AI Town bench (`src/decida/web/bench/town/`)
The concept (one announcement, many residents each deciding what to do, a live stopwatch over the whole town) comes from Matthew Berman's video
"We need to talk about Jev..." (https://www.youtube.com/watch?v=2z-7pIj57f8), where an "AI Town" is shown. We worked from screenshots of it only; no source code was available, and none
was used. The design and implementation are our own. The isometric renderer is our own drawing code; the general technique (an isometric
projection with per-face shading and back-to-front sorting) is common to isometric city drawings, and we looked at the "Pocket Metropolis" page in
the Claude Opus 5.5 100 HTML files collection (file `025-isometric-city.html`, no licence stated) for how
such a page is put together but copied nothing from it. The town layout, citizens, question design and decision rules are ours.
