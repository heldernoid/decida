import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/decida/web/bench/sorter/game.js';

const accuracy = (balls, f) => balls.filter(b => f(b) === b.color).length / balls.length;

test('same seed, same balls; different seed differs; all five colours appear roughly evenly', () => {
  const a = S.makeBalls(5, 500), b = S.makeBalls(5, 500), c = S.makeBalls(6, 500);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  for (const col of S.BUCKETS) { const n = a.filter(x => x.color === col).length; assert.ok(n > 60 && n < 140, `${col}: ${n}`); }
  for (const x of a) for (const v of x.rgb) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
});

test('hue/RGB conversion round-trips within rounding', () => {
  for (const h of [0, 28, 52, 130, 285, 355]) {
    const [r, g, b] = S.hsvToRgb(h, 1, 1), [h2, s2, v2] = S.rgbToHsv(r, g, b);
    assert.ok(Math.min(Math.abs(h2 - h), 360 - Math.abs(h2 - h)) < 1.5, `${h} -> ${h2}`); assert.ok(s2 > 0.99 && v2 > 0.99);
  }
});

test('the nearest-hue oracle is near-perfect when easy, good when normal, worse when hard', () => {
  const acc = d => accuracy(S.makeBalls(3, 4000, d), S.oracle);
  const [e, n, h] = ['easy', 'normal', 'hard'].map(acc);
  assert.ok(e >= 0.995, `easy ${e}`); assert.ok(n >= 0.97, `normal ${n}`); assert.ok(h < n && h >= 0.9, `hard ${h}`);
});

test('colour words: boundaries read as blends, and the name matches the hue', () => {
  assert.equal(S.hueName(355), 'red'); assert.equal(S.hueName(2), 'red'); assert.equal(S.hueName(28), 'orange');
  assert.equal(S.hueName(41), 'orange-yellow'); assert.equal(S.hueName(52), 'yellow'); assert.equal(S.hueName(130), 'green'); assert.equal(S.hueName(285), 'purple');
});

test('guide states the five hue ranges that match the oracle', () => {
  const st = S.toRequest(S.makeBalls(1, 2), 'guide').state;
  assert.match(st, /Hue guide in degrees/);
  for (const c of S.BUCKETS) assert.match(st, new RegExp(`${c} \\d+-\\d+`));
  assert.match(st, /red 320-12/); assert.match(st, /orange 12-40/); assert.match(st, /yellow 40-91/); assert.match(st, /green 91-208/); assert.match(st, /purple 208-320/);
});

test('request: one choice question per ball, five bowls each, hint variants differ', () => {
  const balls = S.makeBalls(2, 40), req = S.toRequest(balls, 'rgb');
  assert.equal(Object.keys(req.questions).length, 40);
  const q = req.questions.b7; assert.equal(q.type, 'choice'); assert.deepEqual(Object.keys(q.criteria), S.BUCKETS);
  assert.match(q.instructions, /Candy #7 reads RGB\(\d+, \d+, \d+\)\. Which bowl does it belong in\?/);
  assert.doesNotMatch(S.toRequest(balls, 'name').questions.b7.instructions, /\d/);
  assert.match(S.toRequest(balls, 'name').questions.b7.instructions, /^A (bright |deep )?[a-z-]+ candy\./);
  assert.match(S.toRequest(balls, 'guide').questions.b7.instructions, /hue \d+ degrees/);
  assert.throws(() => S.toRequest([], 'rgb')); assert.throws(() => S.toRequest(S.makeBalls(1, 257), 'rgb'));
});

test('batching splits the pile without losing or repeating a ball, and respects the API limit', () => {
  const balls = S.makeBalls(4, 1000), bs = S.batches(balls, 64);
  assert.equal(bs.length, Math.ceil(1000 / 64)); assert.equal(bs.flat().length, 1000);
  assert.deepEqual(bs.flat().map(b => b.id), balls.map(b => b.id));
  assert.ok(S.batches(balls, 1000).every(b => b.length <= S.MAX_BATCH));
});

test('confusion matrix and purity', () => {
  const m = S.confusion([['red', 'red'], ['red', 'orange'], ['green', 'green'], ['green', 'green'], ['x', 'red']]);
  assert.equal(m.red.red, 1); assert.equal(m.red.orange, 1); assert.equal(m.green.green, 2);
  assert.equal(S.purity(m), 3 / 4);
  assert.equal(S.purity(S.confusion([])), 0);
});
