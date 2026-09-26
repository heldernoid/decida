// AI Town movement: walking along streets, reacting, and going back to routine.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/decida/web/bench/town/town.js';
import * as S from '../../src/decida/web/bench/town/sim.js';
import { rng } from '../../src/decida/web/bench/common/rng.js';

const fresh = () => { const town = T.buildTown(7), cs = T.makeCitizens(town, 11); S.placeCitizens(cs); return { town, cs }; };
const run = (c, seconds, dt = 0.05, on) => { for (let t = 0; t < seconds; t += dt) S.step(c, dt, on); };

test('citizens start on the street beside their workplace or home, spread out and calm', () => {
  const { cs } = fresh();
  for (const c of cs) { assert.ok(T.isRoad(Math.floor(c.px), Math.floor(c.py)), c.name); assert.equal(c.activity, 'routine'); assert.deepEqual(c.route, []); assert.equal(c.decision, null); }
  assert.ok(new Set(cs.map(c => `${c.px.toFixed(2)},${(c.py).toFixed(2)},${c.ox},${c.oy}`)).size > 40, 'people do not stack');
});

test('sendTo walks street tiles only, at the set speed, and ends at the building', () => {
  const { town, cs } = fresh(), c = cs[0], target = town.buildings.find(b => b.kind === 'library');
  assert.ok(S.sendTo(c, town, target));
  const path = c.route.slice();
  for (const p of path) assert.ok(T.isRoad(Math.floor(p.x), Math.floor(p.y)));
  let last = { x: c.px, y: c.py }, arrived = 0, steps = 0;
  for (let t = 0; t < 120 && c.activity === 'walking'; t += 0.05) {
    S.step(c, 0.05, () => arrived++); steps++;
    assert.ok(Math.hypot(c.px - last.x, c.py - last.y) <= S.SPEED * 0.05 + 1e-9, 'never faster than the speed');
    last = { x: c.px, y: c.py };
  }
  assert.equal(arrived, 1); assert.equal(c.at.id, target.id); assert.equal(c.activity, 'routine');
  assert.deepEqual([Math.floor(c.px), Math.floor(c.py)], [target.access.x, target.access.y]);
  assert.ok(steps * 0.05 <= (path.length + 1) / S.SPEED + 0.2, 'takes about path length / speed');
});

test('reacting: investigating walks to the target, then stays, then heads back to routine', () => {
  const { town, cs } = fresh(), c = cs.find(x => x.quarter === 'orchard'), bakery = town.buildings.find(b => b.kind === 'bakery');
  assert.equal(S.react(c, town, { action: 'investigate', place: 'bakery', feeling: 2 }, bakery), true);
  assert.equal(c.activity, 'reacting-walk'); assert.equal(c.bubble.action, 'investigate');
  let arrivedReacting = false;
  run(c, 60, 0.05, (_, r) => { if (r) arrivedReacting = true; });
  assert.ok(arrivedReacting); assert.equal(c.activity, 'reacting'); assert.equal(c.at.id, bakery.id);
  const rand = rng(3); run(c, S.REACT_STAY + 0.5); S.routine(c, town, cs, rand);
  assert.equal(c.reaction, null); assert.equal(c.bubble, null); assert.ok(c.activity === 'walking' || c.activity === 'routine');
});

test('carrying on sets a bubble but moves nobody; no target means staying put', () => {
  const { town, cs } = fresh(), c = cs[1], before = [c.px, c.py];
  assert.equal(S.react(c, town, { action: 'carry_on', place: 'stay', feeling: 0 }, null), false);
  assert.deepEqual([c.px, c.py], before); assert.equal(c.activity, 'routine');
  assert.equal(S.react(cs[2], town, { action: 'warn_others', place: 'stay', feeling: 2 }, null), false);
});

test('routine: idle citizens wander now and then and always stay on the streets', () => {
  const { town, cs } = fresh(), rand = rng(5);
  const moved = new Set();
  for (let t = 0; t < 90; t += 0.1) for (const c of cs) { S.step(c, 0.1); S.routine(c, town, cs, rand); assert.ok(T.isRoad(Math.floor(c.px), Math.floor(c.py)), `${c.name} off the street at ${c.px},${c.py}`); if (c.activity === 'walking') moved.add(c.id); }
  assert.ok(moved.size >= 30, `${moved.size} of 50 strolled in 90 s`);
});

test('a whole town reacting: everyone with a target arrives, nobody gets stuck', () => {
  const { town, cs } = fresh(), p = { place: 'square', danger: 0.1, offer: 0.9, kind: 'offer' }, salt = T.textSalt('free food');
  let went = 0;
  for (const c of cs) { const d = T.decideByRules(c, p, 'mayor', salt); const tgt = T.targetFor(town, cs, c, d); if (S.react(c, town, d, tgt)) went++; }
  assert.ok(went >= 10);
  for (let t = 0; t < 90; t += 0.1) for (const c of cs) S.step(c, 0.1);
  assert.ok(cs.filter(c => c.activity === 'reacting-walk').length === 0, 'all walks finished');
});
