import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/decida/web/bench/emoji/emoji.js';
import * as W from '../../src/decida/web/bench/emoji/physics.js';

test('emoji set: unique characters and names, within the API limit, every name is plain text', () => {
  assert.ok(E.EMOJIS.length >= 150 && E.EMOJIS.length <= E.MAX_QUESTIONS, `${E.EMOJIS.length}`);
  assert.equal(new Set(E.EMOJIS.map(e => e.char)).size, E.EMOJIS.length, 'duplicate emoji');
  assert.equal(new Set(E.EMOJIS.map(e => e.name)).size, E.EMOJIS.length, 'duplicate name');
  for (const e of E.EMOJIS) assert.match(e.name, /^[a-z][a-z -]*$/, e.name);
  for (const need of ['glove', 'scarf', 'socks', 'hiking boot', 'snowflake', 'umbrella']) assert.ok(E.EMOJIS.some(e => e.name === need), need);
});

test('subset is deterministic, spread across the list, and never larger than asked', () => {
  const a = E.subset(60), b = E.subset(60);
  assert.deepEqual(a, b); assert.equal(a.length, 60); assert.equal(new Set(a.map(e => e.char)).size, 60);
  assert.equal(E.subset(1000).length, E.EMOJIS.length);
  assert.ok(a.some(e => e.name === 'glove') || a[0].name === 'glove');
});

test('request: the query is the state, one short statement per emoji, ids e0.., correct articles', () => {
  const items = E.subset(40), r = E.toRequest('  things you can wear in winter ', items);
  assert.equal(r.state, 'things you can wear in winter');
  assert.equal(Object.keys(r.questions).length, 40);
  assert.ok(Object.values(r.questions).every(q => q.type === 'noul' && /^An? [a-z -]+ is an example of this\.$/.test(q.instructions) && !q.instructions.includes('?')), 'a short statement about the state');
  assert.equal(r.questions.e0.instructions, `${/^[aeiou]/.test(items[0].name) ? 'An' : 'A'} ${items[0].name} is an example of this.`);
  const oct = E.EMOJIS.findIndex(e => e.name === 'octopus'), r2 = E.toRequest('sea', E.EMOJIS);
  assert.equal(r2.questions[`e${oct}`].instructions, 'An octopus is an example of this.');
  assert.throws(() => E.toRequest('', items)); assert.throws(() => E.toRequest('x', []));
  assert.throws(() => E.toRequest('x', Array.from({ length: 257 }, () => items[0])));
});

test('scores, matches and targets', () => {
  const items = [{ char: 'a', name: 'a' }, { char: 'b', name: 'b' }, { char: 'c', name: 'c' }, { char: 'd', name: 'd' }];
  const list = E.scores({ e0: { noul: 0.2 }, e1: { noul: 0.9 }, e2: { noul: 0.6 }, e3: { noul: 1.4 } }, items);
  assert.equal(list[3].p, 1, 'probabilities are clamped');
  assert.deepEqual(E.matches(list, .5).map(e => e.char), ['d', 'b', 'c']);
  assert.deepEqual(E.matches(list, .5, 2).map(e => e.char), ['d', 'b']);
  assert.deepEqual(E.topK(list, 2).map(e => e.char), ['d', 'b']); assert.equal(E.topK(list, 10).length, 4);
  assert.deepEqual(E.topK(E.scores({ e0: { noul: 0.02 }, e1: { noul: 0.01 }, e2: { noul: 0.05 }, e3: { noul: 0.0 } }, items), 2).map(e => e.char), ['c', 'a'], 'ranks even when every probability is tiny');
  const t = E.targets(3, 900, 150, 60);
  assert.deepEqual(t.map(p => p.x), [840 / 2 + 0 + 30 - 30 + 0 * 0 + 0, 450, 510].map((_, i) => 450 + (i - 1) * 60)); assert.ok(t.every(p => p.y === 150));
  const two = E.targets(14, 900, 150, 62, 12);
  assert.equal(two.filter(p => p.y === 150).length, 12); assert.equal(two.filter(p => p.y === 212).length, 2);
  assert.ok(Math.abs(two.filter(p => p.y === 150).reduce((a, p) => a + p.x, 0) / 12 - 450) < 1e-9, 'rows are centred');
});

function settle(w, secs = 6) { for (let i = 0; i < secs * 60; i++) W.step(w, 1 / 60); }

test('physics: emoji rain into a pile that stays inside the box with little overlap', () => {
  const w = W.makeWorld(900, 560, 150, 17, 3);
  settle(w, 9);
  for (const b of w.bodies) { assert.ok(b.y + b.r <= w.floor + 0.5, `below floor ${b.y}`); assert.ok(b.x - b.r >= -0.5 && b.x + b.r <= w.W + 0.5, 'outside the walls'); }
  let worst = 0; for (let i = 0; i < 150; i++) for (let j = i + 1; j < 150; j++) { const a = w.bodies[i], b = w.bodies[j], o = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y); worst = Math.max(worst, o); }
  assert.ok(worst < 6, `worst overlap ${worst.toFixed(1)} px`);
  const speed = Math.max(...w.bodies.map(b => Math.hypot(b.vx, b.vy)));
  assert.ok(speed < 60, `pile still moving at ${speed.toFixed(0)} px/s`);
  const ys = w.bodies.map(b => b.y).sort((a, b) => a - b);
  assert.ok(ys[10] > 560 - 10 - 17 * 2 * 8, `a mound, not a tower: the 10th-highest emoji is at y=${ys[10].toFixed(0)}`); // a lone emoji may perch on the peak
});

test('physics: lifted bodies rise to their target and hover; released ones fall back', () => {
  const w = W.makeWorld(900, 560, 100, 17, 5); settle(w, 8);
  const picked = w.bodies.slice(0, 5), tg = E.targets(5, 900, 150, 62);
  picked.forEach((b, i) => { b.lift = tg[i]; });
  settle(w, 2.5);
  picked.forEach((b, i) => { assert.ok(Math.hypot(b.x - tg[i].x, b.y - tg[i].y) < 4, `body ${i} at ${b.x.toFixed(0)},${b.y.toFixed(0)}`); });
  picked.forEach(b => { b.lift = null; });
  settle(w, 4);
  for (const b of picked) assert.ok(b.y > 300, `body did not fall back: y=${b.y.toFixed(0)}`);
});

test('physics is deterministic for a seed', () => {
  const run = seed => { const w = W.makeWorld(900, 560, 60, 17, seed); settle(w, 4); return JSON.stringify(w.bodies.map(b => [Math.round(b.x), Math.round(b.y)])); };
  assert.equal(run(2), run(2)); assert.notEqual(run(2), run(3));
});

test('pickMatches: a cut-off for a model that separates emoji, ranking for one that says yes (or no) to everything', () => {
  const mk = ps => E.scores(Object.fromEntries(ps.map((p, i) => [`e${i}`, { noul: p }])), ps.map((_, i) => ({ char: String(i), name: 'n' + i })));
  const clear = mk([0.97, 0.9, 0.05, 0.03, 0.02, 0.04, 0.06, 0.01]);          // like a large model
  const yes = mk([0.69, 0.62, 0.58, 0.57, 0.55, 0.54, 0.53, 0.52, 0.51, 0.5]); // says ~54% to everything
  const no = mk([0.3, 0.2, 0.1, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01]);    // says no to everything
  const a = E.pickMatches(clear); assert.equal(a.mode, 'threshold'); assert.equal(a.hit.length, 2); assert.equal(a.note, '');
  const b = E.pickMatches(yes); assert.equal(b.mode, 'rank'); assert.equal(b.hit.length, 8); assert.match(b.note, /about 5\d% for almost everything/);
  const c = E.pickMatches(no); assert.equal(c.mode, 'rank'); assert.equal(c.hit.length, 8); assert.match(c.note, /Nothing reached 50%/);
  assert.equal(E.pickMatches(yes, 'thr').hit.length, 10, 'an explicit cut-off is honoured'); assert.equal(E.pickMatches(clear, 'top').hit.length, 8);
  assert.ok(E.signal(clear).spread > 0.9 && E.signal(yes).spread < 0.2);
  assert.deepEqual(E.pickMatches(yes).hit.map(e => e.char).slice(0, 3), ['0', '1', '2']);
});
