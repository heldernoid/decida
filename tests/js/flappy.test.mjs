import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../src/decida/web/bench/flappy/game.js';

// Play `secs` of game time. The policy is asked every `every` frames and its decision is applied `lag` frames later (answer latency).
function play(seed, policy, secs = 60, every = 1, lag = 0) {
  const g = F.newGame(seed), q = []; let flapNow = false, frames = 0;
  for (let i = 0; i < secs * 60; i++) {
    if (i % every === 0) q.push({ at: i + lag, flap: policy(g) });
    while (q.length && q[0].at <= i) flapNow = q.shift().flap;
    F.step(g, flapNow); frames++;
  }
  return g;
}

test('same seed, same course; different seed differs', () => {
  const gaps = s => F.newGame(s).pillars.map(p => p.c.toFixed(3)).join();
  assert.equal(gaps(4), gaps(4)); assert.notEqual(gaps(4), gaps(5));
  for (const p of F.newGame(9).pillars) assert.ok(p.c >= 3 && p.c <= 7.6);
});

test('physics: gravity pulls down, a flap kicks up, the cooldown stops machine-gun flapping', () => {
  const g = F.newGame(1); g.pillars = [];
  F.step(g, false); assert.ok(g.vy < 0);
  assert.ok(F.flap(g) && Math.abs(g.vy - F.FLAP_V) < 1e-9);
  assert.equal(F.flap(g), false, 'cooling down');
  for (let i = 0; i < 12; i++) F.step(g, false); assert.ok(F.flap(g), 'cooldown over after 0.18 s');
});

test('bands: the bird height is put into words at the documented boundaries', () => {
  assert.equal(F.bandOf(-2), 'far below'); assert.equal(F.bandOf(-0.8), 'a little below'); assert.equal(F.bandOf(0), 'level with');
  assert.equal(F.bandOf(0.8), 'a little above'); assert.equal(F.bandOf(2), 'far above');
  assert.equal(F.classOf(-0.9), 'below'); assert.equal(F.classOf(0), 'level'); assert.equal(F.classOf(0.9), 'above');
});

test('observation: words by default, numbers or an action question in the teaching variants', () => {
  const g = F.newGame(1); g.pillars[0].x = 2; g.pillars[0].c = 6; g.y = 4.5;
  const w = F.observe(g, 'words'); assert.equal(w.state, 'The bird is far below the gap.'); assert.deepEqual(Object.keys(w.questions.where.criteria), ['below', 'level', 'above']);
  const n = F.observe(g, 'numbers'); assert.equal(n.state, 'Bird altitude: 4.5. Gap altitude: 6.0.'); assert.match(n.state, /\d/); assert.doesNotMatch(w.state, /\d/);
  const a = F.observe(g, 'action'); assert.deepEqual(Object.keys(a.questions.act.criteria), ['flap', 'glide']); assert.equal(a.state, w.state);
});

test('decide: flap only when the probability clears the threshold; the reason is spelled out', () => {
  const ans = p => ({ where: { probabilities: { below: p, level: (1 - p) / 2, above: (1 - p) / 2 }, choice: 'below' } });
  assert.equal(F.decide(ans(0.7), 0.5).flap, true); assert.equal(F.decide(ans(0.5), 0.5).flap, false); assert.equal(F.decide(ans(0.7), 0.8).flap, false);
  assert.equal(F.decide(ans(0.7), 0.5).why, 'P(below) 0.70 > 0.50');
  assert.equal(F.decide({ act: { probabilities: { flap: 0.9, glide: 0.1 } } }, 0.5, 'action').label, 'FLAP');
});

test('collisions and scoring: a gap passed scores, a pillar hit crashes, the ground crashes', () => {
  const g = F.newGame(1); g.y = 1; g.vy = 0;
  g.pillars = [{ x: 0.2, c: 8, passed: false }]; F.step(g, false); assert.ok(g.dead > 0 && g.crashes === 1, 'pillar hit');
  const h = F.newGame(1); h.pillars = [{ x: 0.1, c: 5.5, passed: false }]; h.y = 5.5; h.vy = 0;
  for (let i = 0; i < 40; i++) { if (h.vy < -1) F.flap(h); F.step(h, false); if (h.dead) break; }
  assert.ok(h.score >= 1 && !h.dead, `passed a gap: score ${h.score}`);
  const f = F.newGame(1); f.pillars = []; f.y = 0.2; F.step(f, false); assert.ok(f.dead > 0, 'ground');
});

test('a reader who is told the truth survives 60 s on 5 courses at 60 Hz; a slow decision loop costs a little', () => {
  let slow = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = play(seed, F.oracleFlap, 60, 1, 0); assert.equal(g.crashes, 0, `seed ${seed} at 60 Hz: ${g.crashes} crashes`); assert.ok(g.score >= 8, `score ${g.score}`);
    const h = play(seed, F.oracleFlap, 60, 3, 3); assert.ok(h.crashes <= 1, `seed ${seed} at 20 Hz + 3 frames of lag: ${h.crashes} crashes`); slow += h.crashes;
  }
  assert.ok(slow <= 2, `${slow} crashes over 5 courses with 20 decisions/s and 3 frames of lag`);
});

test('never flapping crashes; always flapping crashes into the ceiling gap', () => {
  assert.ok(play(1, () => false, 20).crashes > 0); assert.ok(play(1, () => true, 30).crashes > 0);
});
