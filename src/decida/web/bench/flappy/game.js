// Flappy: a bird, pillars with a gap, and a model that says where the bird is relative to the gap.
// Adapted from the Flappy demo in https://github.com/wdobry/laya-playground (MIT; static/demos/flappy.js, see THIRD_PARTY.md):
// the game puts the bird's height into WORDS, asks one perception question, and code turns the probability into a flap with a
// threshold. Asking what to DO comes out inverted for encoder models, and numbers are not understood, so both are offered as
// variants to show it. Pure logic, no DOM: runs in the browser and under node.
import { rng } from '../common/rng.js';

export const G = 22, FLAP_V = 6.8, COOLDOWN = 0.18, SPEED = 6.6, SPACING = 8.5, GAP = 3.5, PW = 1.4, CEIL = 10.6, R = 0.32, DT = 1 / 60;
export const BANDS = [[-1.2, 'far below'], [-0.4, 'a little below'], [0.4, 'level with'], [1.2, 'a little above'], [Infinity, 'far above']];
export const CLASSES = ['below', 'level', 'above'];

export function newGame(seed = 1) {
  const g = { seed, rand: rng(seed), t: 0, y: 5.5, vy: 0, cool: 0, score: 0, best: 0, crashes: 0, dead: 0, wing: 0, pillars: [] };
  let c = 5.5;
  for (let i = 0; i < 7; i++) { c = nextGap(g, c); g.pillars.push({ x: 11 + i * SPACING, c, passed: false }); }
  return g;
}
const nextGap = (g, prev) => Math.max(3, Math.min(7.6, prev + (g.rand() * 2 - 1) * 2.6));

export function reset(g) { // after a crash: a fresh course, the score starts again, the best is kept
  g.y = 5.5; g.vy = 0; g.cool = 0; g.score = 0; g.dead = 0; g.wing = 0; g.pillars = [];
  let c = 5.5; for (let i = 0; i < 7; i++) { c = nextGap(g, c); g.pillars.push({ x: 11 + i * SPACING, c, passed: false }); }
}

export const target = g => g.pillars.find(p => p.x + PW / 2 > -0.4);

export function flap(g) { if (g.cool <= 0 && !g.dead) { g.vy = FLAP_V; g.cool = COOLDOWN; g.wing = 1; return true; } return false; }

// One fixed step. `wantFlap` is the model's decision at this moment.
export function step(g, wantFlap = false, dt = DT) {
  g.t += dt;
  if (g.dead) { g.dead -= dt; if (g.dead <= 0) reset(g); return; }
  g.cool -= dt;
  if (wantFlap) flap(g);
  g.vy -= G * dt; g.y += g.vy * dt; g.wing = Math.max(0, g.wing - dt * 5);
  if (g.y > CEIL) { g.y = CEIL; g.vy = Math.min(0, g.vy); }
  for (const p of g.pillars) {
    p.x -= SPEED * dt;
    if (!p.passed && p.x + PW / 2 < -R) { p.passed = true; g.score++; g.best = Math.max(g.best, g.score); }
    if (Math.abs(p.x) < PW / 2 + R && (g.y - R < p.c - GAP / 2 || g.y + R > p.c + GAP / 2)) crash(g);
  }
  if (g.y < R) crash(g);
  const last = g.pillars[g.pillars.length - 1];
  if (last && g.pillars[0].x < -14) { g.pillars.shift(); g.pillars.push({ x: last.x + SPACING, c: nextGap(g, last.c), passed: false }); }
}
function crash(g) { if (!g.dead) { g.dead = 1.1; g.crashes++; } }

// The ground truth the model is judged against: how far the bird is from the middle of the next gap.
export const offset = g => g.y - (target(g) ? target(g).c : 5.5);
export const bandOf = d => BANDS.find(b => d < b[0])[1];
export const classOf = d => (d < -0.4 ? 'below' : d < 0.4 ? 'level' : 'above');

// variants:
//   'words'   (default) the situation in words, and the perception question "where is the bird relative to the gap?"
//   'numbers' the same question, but the state is numbers ("bird altitude 4.2, gap altitude 5.9"): small models cannot compare them
//   'action'  the state in words, but the question asks what to DO (flap or glide): comes out inverted for encoder models
export function observe(g, variant = 'words') {
  const t = target(g), d = offset(g);
  if (variant === 'numbers') {
    return { state: `Bird altitude: ${g.y.toFixed(1)}. Gap altitude: ${(t ? t.c : 5.5).toFixed(1)}.`, questions: { where: { type: 'choice', instructions: 'Where is the bird relative to the gap?', criteria: { below: 'lower than the gap', level: 'lined up with the gap', above: 'higher than the gap' } } } };
  }
  const state = `The bird is ${bandOf(d)} the gap.`;
  if (variant === 'action') return { state, questions: { act: { type: 'choice', instructions: 'What should the bird do now?', criteria: { flap: 'flap its wings to rise', glide: 'glide and let gravity pull it down' } } } };
  return { state, questions: { where: { type: 'choice', instructions: 'Where is the bird relative to the gap?', criteria: { below: 'lower than the gap', level: 'lined up with the gap', above: 'higher than the gap' } } } };
}

// Turn the model's answer into a decision. `threshold` is the policy knob: flap when P(below) (or P(flap)) clears it.
export function decide(answers, threshold, variant = 'words') {
  if (variant === 'action') { const p = answers.act.probabilities.flap; return { flap: p > threshold, p, label: p > threshold ? 'FLAP' : 'GLIDE', why: `P(flap) ${p.toFixed(2)} ${p > threshold ? '>' : '≤'} ${threshold.toFixed(2)}` }; }
  const a = answers.where, p = a.probabilities.below;
  return { flap: p > threshold, p, label: p > threshold ? 'FLAP' : 'GLIDE', why: `P(below) ${p.toFixed(2)} ${p > threshold ? '>' : '≤'} ${threshold.toFixed(2)}`, cls: a.choice };
}

// A reference policy that is told the truth (what a perfect reader of the words would answer).
export const oracleFlap = g => offset(g) < -0.4;
