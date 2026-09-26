// The dino scene draws every state without throwing and stays inside the game's coordinate space.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../src/decida/web/bench/dino/game.js';
import { drawScene, GROUND_Y } from '../../src/decida/web/bench/dino/scene.js';

// A context that records calls and returns gradient stubs, so drawing code runs without a canvas.
function fakeCtx() {
  const calls = { n: 0, nan: 0 };
  const grad = { addColorStop() {} };
  const c = new Proxy({}, {
    get: (t, k) => {
      if (k === 'calls') return calls;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k in t) return t[k];
      return (...a) => { calls.n++; if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) calls.nan++; };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return c;
}

function runTo(frames, action, seed = 3) {
  const g = G.newGame(seed);
  for (let i = 0; i < frames; i++) { G.applyAction(g, action(i)); G.step(g); if (g.crashed) break; }
  return g;
}

test('draws running, jumping, ducking and dead states with finite coordinates', () => {
  const cases = [
    ['run', runTo(120, () => 'run')],
    ['jump', runTo(20, i => (i === 5 ? 'jump' : 'run'))],
    ['duck', runTo(40, () => 'duck')],
    ['late', runTo(900, i => (i % 40 === 0 ? 'jump' : 'run'))],
  ];
  for (const [name, g] of cases) {
    for (const dead of [false, true]) {
      const c = fakeCtx();
      drawScene(c, g, { dead, flash: dead ? 1 : 0 });
      assert.ok(c.calls.n > 50, `${name}: drew something`);
      assert.equal(c.calls.nan, 0, `${name}: no NaN or Infinity coordinates`);
    }
  }
});

test('draws every obstacle kind, and the same frame twice makes identical calls', () => {
  const g = G.newGame(1);
  g.obstacles = [{ kind: 'cactus', size: 'small', n: 2, x: 200, w: 34, h: 35, y0: 0 }, { kind: 'cactus', size: 'large', n: 1, x: 300, w: 25, h: 50, y0: 0 }, { kind: 'bird', x: 420, w: 46, h: 40, y0: 40 }];
  const a = fakeCtx(), b = fakeCtx();
  drawScene(a, g); drawScene(b, g);
  assert.equal(a.calls.n, b.calls.n);
  assert.equal(a.calls.nan, 0);
  assert.equal(GROUND_Y, 140);
});
