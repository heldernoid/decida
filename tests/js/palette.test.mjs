import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/decida/web/bench/palette/palette.js';

test('palette: 12 unique colours with valid hex codes and a description each, within the LM limit', () => {
  assert.equal(C.PALETTE.length, 12); assert.ok(C.PALETTE.length <= C.MAX_COLOURS);
  assert.equal(new Set(C.PALETTE.map(c => c.name)).size, 12); assert.equal(new Set(C.PALETTE.map(c => c.hex)).size, 12);
  for (const c of C.PALETTE) { assert.match(c.hex, /^#[0-9a-f]{6}$/); assert.ok(c.typical.length > 8, c.name); }
  assert.ok(C.PALETTE.find(c => c.name === 'red').typical.includes('tomatoes'), 'the description is what the model matches "tomato" against');
});

test('single request: the phrase is the state, one question, every option described', () => {
  const r = C.toRequest('  tomato on a vine ', 'single');
  assert.equal(r.state, 'tomato on a vine'); assert.deepEqual(Object.keys(r.questions), ['colour']);
  const q = r.questions.colour; assert.equal(q.type, 'choice'); assert.equal(q.instructions, 'Which colour does this make you think of?');
  assert.deepEqual(Object.keys(q.criteria), C.PALETTE.map(c => c.name));
  assert.equal(q.criteria.red, 'red, the colour of tomatoes, fire trucks, roses, blood');
  assert.ok(Object.values(q.criteria).every(t => t.length <= 70), 'short enough for the encoder option budget');
  assert.throws(() => C.toRequest('   ')); assert.throws(() => C.toRequest(''));
});

test('rotated request: the same question with the option list rotated evenly, same options, deterministic', () => {
  const r = C.toRequest('neon tokyo', 'rotated'), ids = Object.keys(r.questions), names = C.PALETTE.map(c => c.name);
  assert.deepEqual(ids, ['o0', 'o1', 'o2', 'o3']);
  assert.deepEqual(Object.keys(r.questions.o0.criteria), names, 'the first copy keeps the natural order');
  const orders = ids.map(k => Object.keys(r.questions[k].criteria));
  assert.equal(new Set(orders.map(o => o.join())).size, 4, 'four different orders');
  for (const o of orders) assert.deepEqual(o.slice().sort(), names.slice().sort());
  for (const n of names) assert.equal(new Set(orders.map(o => o.indexOf(n))).size, 4, `${n} sits at four different positions`);
  assert.deepEqual(orders[1].slice(0, 3), names.slice(3, 6), 'rotated by a quarter of the list');
  assert.deepEqual(C.toRequest('a completely different phrase', 'rotated').questions.o2.criteria, r.questions.o2.criteria, 'not phrase dependent: the same rotations every time');
  assert.equal(Object.keys(C.toRequest('x', 'rotated', 3).questions).length, 3);
});

test('shares from a single answer sum to 1 and are sorted largest first', () => {
  const probs = Object.fromEntries(C.PALETTE.map(c => [c.name, 0.001])); probs.red = 0.9; probs.green = 0.06;
  const s = C.shares({ colour: { probabilities: probs } });
  assert.equal(s[0].name, 'red'); assert.equal(s[1].name, 'green');
  assert.ok(Math.abs(s.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].share >= s[i].share);
});

test('shares from rotated answers are averaged by colour, whatever the order in each answer', () => {
  const ans = (r, g) => ({ probabilities: Object.fromEntries(C.PALETTE.map(c => [c.name, c.name === 'red' ? r : c.name === 'green' ? g : 0])) });
  const s = C.shares({ o0: ans(1, 0), o1: ans(0.5, 0.5), o2: ans(0.9, 0.1) }, 'rotated');
  assert.equal(s[0].name, 'red'); assert.ok(Math.abs(s[0].share - (2.4 / 3) / (3 / 3)) < 1e-9); assert.ok(Math.abs(s[1].share - (0.6 / 3)) < 1e-9);
  assert.ok(C.shares({ o0: { probabilities: {} } }, 'rotated').every(c => Number.isFinite(c.share)), 'nothing chosen: no NaN');
});

test('layout: slivers are dropped, widths renormalise to 100% and stripes touch', () => {
  const list = [{ name: 'a', hex: '#000000', share: .7 }, { name: 'b', hex: '#ffffff', share: .29 }, { name: 'c', hex: '#ff0000', share: .001 }, { name: 'd', hex: '#00ff00', share: .009 }];
  const { stripes, hidden } = C.layout(list, 0.004);
  assert.equal(hidden, 1); assert.equal(stripes.length, 3);
  assert.ok(Math.abs(stripes.reduce((a, s) => a + s.width, 0) - 100) < 1e-9);
  assert.ok(Math.abs(stripes[1].left - stripes[0].width) < 1e-9);
});

test('text colour: dark on light stripes, light on dark ones', () => {
  assert.equal(C.textOn('#ffd000'), '#111'); assert.equal(C.textOn('#ffffff'), '#111');
  assert.equal(C.textOn('#000000'), '#fff'); assert.equal(C.textOn('#8620b8'), '#fff');
});

test('sharpen keeps the ranking, sums to 1 and makes a flat distribution decisive; auto picks the gentlest contrast', () => {
  const mk = ps => C.PALETTE.map((c, i) => ({ ...c, share: ps[i] ?? 0 })).sort((a, b) => b.share - a.share);
  const flat = mk([0.23, 0.15, 0.12, 0.1, 0.09, 0.08, 0.07, 0.06, 0.04, 0.03, 0.02, 0.01]);
  const sharp = C.sharpen(flat, 4);
  assert.deepEqual(sharp.map(c => c.name), flat.map(c => c.name), 'same order');
  assert.ok(Math.abs(sharp.reduce((a, c) => a + c.share, 0) - 1) < 1e-9); assert.ok(sharp[0].share > flat[0].share * 1.8);
  assert.equal(C.sharpen(flat, 1), flat);
  assert.equal(C.autoGamma(mk([0.9, 0.05, 0.05])), 1, 'a confident model needs no contrast');
  const g = C.autoGamma(flat); assert.ok(g > 1 && g <= 6); assert.ok(C.sharpen(flat, g)[0].share >= 0.5 || g === 6);
  assert.ok(C.GAMMAS.indexOf(g) === 0 || C.sharpen(flat, C.GAMMAS[C.GAMMAS.indexOf(g) - 1])[0].share < 0.5, 'and not stronger than needed');
  assert.ok(C.sharpen(mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 3).every(c => Number.isFinite(c.share)), 'all zero: no NaN');
});
