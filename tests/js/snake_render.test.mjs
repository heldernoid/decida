import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../src/decida/web/bench/snake/render.js';

const body = (...xy) => xy.map(([x, y]) => ({ x, y }));

test('alignPrev: same length after a normal move, one extra segment (at the old tail) after eating', () => {
  const before = body([3, 3], [2, 3], [1, 3]);
  assert.deepEqual(R.alignPrev(before, body([4, 3], [3, 3], [2, 3])), before);
  const grown = R.alignPrev(before, body([4, 3], [3, 3], [2, 3], [1, 3]));
  assert.equal(grown.length, 4); assert.deepEqual(grown[3], { x: 1, y: 3 }); assert.deepEqual(grown[2], { x: 1, y: 3 });
  assert.notEqual(grown[3], grown[2], 'copies, not shared references');
});

test('lerpBody: u=0 shows the old cells, u=1 the new ones, halfway in between, all centred in their cell', () => {
  const prev = body([3, 3], [2, 3], [1, 3]), cur = body([4, 3], [3, 3], [2, 3]);
  assert.deepEqual(R.lerpBody(prev, cur, 0), body([3.5, 3.5], [2.5, 3.5], [1.5, 3.5]));
  assert.deepEqual(R.lerpBody(prev, cur, 1), body([4.5, 3.5], [3.5, 3.5], [2.5, 3.5]));
  assert.deepEqual(R.lerpBody(prev, cur, .5), body([4, 3.5], [3, 3.5], [2, 3.5]));
  assert.deepEqual(R.lerpBody(prev, cur, 7), R.lerpBody(prev, cur, 1), 'u is clamped');
  assert.deepEqual(R.lerpBody(prev, cur, -1), R.lerpBody(prev, cur, 0));
});

test('smoothPath: starts and ends at the end centres, s runs 0..1 head to tail, corners are rounded', () => {
  const pts = body([5.5, 1.5], [5.5, 2.5], [5.5, 3.5], [4.5, 3.5], [3.5, 3.5]); // a bend
  const path = R.smoothPath(pts, 8);
  assert.deepEqual([path[0].x, path[0].y], [5.5, 1.5]);
  const last = path[path.length - 1]; assert.deepEqual([last.x, last.y, last.s], [3.5, 3.5, 1]);
  assert.equal(path[0].s, 0); for (let i = 1; i < path.length; i++) assert.ok(path[i].s > path[i - 1].s);
  assert.ok(path.length >= 8 * (pts.length - 1) - 1);
  // the sharp corner at (5.5, 3.5) is cut: no sampled point sits exactly on it
  assert.ok(path.every(p => !(p.x === 5.5 && p.y === 3.5)));
  // a straight body stays straight
  assert.ok(R.smoothPath(body([1.5, 1.5], [2.5, 1.5], [3.5, 1.5])).every(p => Math.abs(p.y - 1.5) < 1e-9));
  assert.deepEqual(R.smoothPath([]), []); assert.equal(R.smoothPath(body([1, 1])).length, 1);
});

test('radiusAt tapers from head to tail; heading points where the head faces', () => {
  assert.ok(R.radiusAt(0) > R.radiusAt(.5) && R.radiusAt(.5) > R.radiusAt(1) && R.radiusAt(1) > 0);
  assert.equal(R.radiusAt(0, 40), 40 * R.radiusAt(0));
  assert.equal(R.heading(body([4.5, 3.5], [3.5, 3.5])), 0);              // moving right
  assert.equal(R.heading(body([4.5, 4.5], [4.5, 3.5])), Math.PI / 2);   // moving down
  assert.equal(R.heading(body([4.5, 2.5], [4.5, 3.5])), -Math.PI / 2);  // moving up
});
