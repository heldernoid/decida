import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../src/decida/web/bench/dino/game.js';

const FRAMES = 3600; // 60 s

function play(seed, policy, lat = 0, frames = FRAMES, every = 4) {
  const g = G.newGame(seed);
  let deaths = 0, pending = [];
  for (let f = 0; f < frames; f++) {
    pending = pending.filter(p => { if (f >= p.at) { G.applyAction(g, p.a); return false; } return true; });
    if (f % every === 0) { const a = policy(g, lat); pending.push({ at: f + lat, a }); }
    G.step(g);
    if (g.crashed) { deaths++; Object.assign(g, G.newGame(seed), { rand: G.rng(seed + deaths) }); pending = []; }
  }
  return { deaths, dist: g.dist };
}
const oracle = (g, lat) => G.plan(g, lat, 4).best;

test('same seed, same course', () => {
  const trace = seed => { const g = G.newGame(seed); const xs = []; for (let i = 0; i < 900; i++) { G.step(g); xs.push(g.obstacles.map(o => o.kind + o.w + '@' + o.x.toFixed(2)).join()); } return xs.join('|'); };
  assert.equal(trace(7), trace(7));
  assert.notEqual(trace(7), trace(8));
});

test('doing nothing eventually crashes', () => {
  assert.ok(play(1, () => 'run').deaths > 0);
});

test('jump physics: peak near 83 px and lands', () => {
  const g = G.newGame(1); G.applyAction(g, 'jump');
  let peak = 0, frames = 0;
  while ((g.y > 0 || g.vy > 0) && frames < 100) { G.step(g, false); peak = Math.max(peak, g.y); frames++; }
  assert.ok(peak > 75 && peak < 90, `peak ${peak}`);
  assert.equal(g.y, 0);
  assert.ok(frames > 28 && frames < 40, `air frames ${frames}`);
});

test('collision boxes: cactus hits a runner, a mid bird misses a ducker', () => {
  const g = G.newGame(1);
  g.obstacles = [{ id: 1, kind: 'cactus', size: 'small', n: 1, w: 17, h: 35, y0: 0, x: 60 }];
  assert.ok(G.collides(g));
  g.obstacles = [{ id: 2, kind: 'bird', level: 'mid', n: 1, w: 46, h: 40, y0: 40, x: 60 }];
  assert.ok(G.collides(g));
  g.duck = true; assert.ok(!G.collides(g));
});

test('planner survives 5 seeds x 60 s with zero latency', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = play(seed, oracle, 0);
    assert.equal(r.deaths, 0, `seed ${seed} died ${r.deaths}x`);
  }
});

test('planner survives with 6 frames (100 ms) of answer latency', () => {
  for (const seed of [1, 2, 3]) {
    const r = play(seed, (g) => G.plan(g, 6, 4).best, 6);
    assert.equal(r.deaths, 0, `seed ${seed} died ${r.deaths}x`);
  }
});

test('planner survives with the real cadence: ask every 6 frames, answers 2 to 8 frames late', () => {
  for (const lat of [2, 5, 8]) for (const seed of [1, 2, 3, 4, 5]) {
    const r = play(seed, g => G.plan(g, lat, 6).best, lat, FRAMES, 6);
    assert.equal(r.deaths, 0, `lat ${lat} seed ${seed} died ${r.deaths}x`);
  }
});

test('request has the documented shape and exactly one Best safe option', () => {
  const g = G.newGame(3);
  for (let i = 0; i < 400 && !(G.nextObstacle(g) && G.nextObstacle(g).x < 300); i++) G.step(g);
  const { request } = G.toRequest(g, 4);
  const q = request.questions.action;
  assert.equal(q.type, 'choice');
  assert.deepEqual(Object.keys(q.criteria), ['run', 'jump', 'duck']);
  assert.match(request.state, /^Dino runner game\./);
  const best = Object.values(q.criteria).filter(t => t.endsWith('Best.'));
  assert.equal(best.length, 1);
  assert.ok(Object.values(q.criteria).some(t => t.startsWith('Unsafe.')));
});

test('regression: ducking under a mid bird, "run" is unsafe and duck stays best', () => {
  const g = G.newGame(1);
  g.duck = true;
  g.obstacles = [{ id: 1, kind: 'bird', level: 'mid', n: 1, w: 46, h: 40, y0: 40, x: 70 }]; // overhead now
  const p = G.plan(g, 3, 6);
  assert.ok(!p.safe.includes('run'), JSON.stringify(p.scores));
  assert.equal(p.best, 'duck');
});

test('a lazy model that always prefers "run" when it is labelled safe still survives (wait guarantee)', () => {
  const lazy = lat => g => { const p = G.plan(g, lat, 6); return p.safe.includes('run') ? 'run' : p.best; };
  for (const lat of [2, 3, 4]) for (const seed of [1, 2, 3, 4, 5]) {
    const r = play(seed, lazy(lat), lat + 1, FRAMES, 6); // real answer arrives 1 frame later than assumed
    assert.equal(r.deaths, 0, `lat ${lat} seed ${seed} died ${r.deaths}x`);
  }
});

test('hints modes: full has one Best, nobest has none, none has no safety words', () => {
  const g = G.newGame(3);
  for (let i = 0; i < 400 && !(G.nextObstacle(g) && G.nextObstacle(g).x < 300); i++) G.step(g);
  const text = h => Object.values(G.toRequest(g, 4, 6, h).request.questions.action.criteria).join(' ');
  assert.equal((text('full').match(/Best\./g) || []).length, 1);
  assert.equal((text('nobest').match(/Best\./g) || []).length, 0);
  assert.match(text('nobest'), /Unsafe|Safe/);
  assert.doesNotMatch(text('none'), /Safe|Unsafe|Best|Collision/i);
  assert.match(G.toRequest(g, 4, 6, 'none').request.state, /Speed \d+\.\d px per frame/);
});
