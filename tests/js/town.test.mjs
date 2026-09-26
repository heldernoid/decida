// AI Town logic: the town is deterministic and connected, citizens are well formed, states are words, decisions map to places.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/decida/web/bench/town/town.js';

const town = T.buildTown(7), citizens = T.makeCitizens(town, 11);

test('the same seed gives the same town and the same citizens', () => {
  assert.deepEqual(T.buildTown(7).buildings.map(b => [b.id, b.x, b.y]), town.buildings.map(b => [b.id, b.x, b.y]));
  assert.deepEqual(T.makeCitizens(T.buildTown(7), 11).map(c => [c.name, c.role, c.home.id]), citizens.map(c => [c.name, c.role, c.home.id]));
  assert.notDeepEqual(T.buildTown(8).buildings.map(b => [b.x, b.y]), town.buildings.map(b => [b.x, b.y]));
});

test('every neighbourhood has a bakery, clinic, fire station and park; the middle has the shared amenities exactly once', () => {
  for (const q of T.QUARTERS) for (const kind of ['bakery', 'clinic', 'fire', 'park']) assert.equal(town.buildings.filter(b => b.quarter === q.id && b.kind === kind).length, 1, `${q.id} ${kind}`);
  for (const kind of ['hall', 'library', 'cinema', 'school']) assert.equal(town.buildings.filter(b => b.kind === kind).length, 1, kind);
  assert.equal(town.buildings.filter(b => b.kind === 'market').length, 2);
  assert.ok(town.buildings.some(b => b.kind === 'square'));
  assert.ok(town.buildings.filter(b => b.kind === 'home').length >= 50, 'enough homes for fifty citizens');
});

test('no two buildings share a tile, and every building has a street beside it that reaches the whole town', () => {
  const seen = new Set();
  for (const b of town.buildings) { const k = `${b.x},${b.y}`; assert.ok(!seen.has(k), `overlap at ${k}`); seen.add(k); }
  const hub = town.buildings.find(b => b.kind === 'square').access;
  for (const b of town.buildings) {
    assert.ok(T.isRoad(b.access.x, b.access.y), `${b.name}: access is a road`);
    assert.equal(Math.abs(b.access.x - b.x) + Math.abs(b.access.y - b.y), b.kind === 'square' ? 2 : 1, `${b.name}: access is next to the building`);
    assert.ok(T.roadPath(b.access, hub).length > 0, `${b.name} is reachable`);
  }
});

test('roadPath walks street tiles one step at a time', () => {
  const a = town.buildings.find(b => b.kind === 'bakery').access, b = town.buildings.find(b => b.kind === 'fire' && b.quarter === 'harbor').access;
  const p = T.roadPath(a, b);
  assert.deepEqual([p[0].x, p[0].y], [a.x, a.y]); assert.deepEqual([p.at(-1).x, p.at(-1).y], [b.x, b.y]);
  for (let i = 1; i < p.length; i++) { assert.equal(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y), 1); assert.ok(T.isRoad(p[i].x, p[i].y)); }
  assert.equal(T.roadPath(a, a).length, 1);
  assert.deepEqual(T.roadPath(a, { x: 3, y: 3 }), [], 'a tile that is not a street has no route');
});

test('fifty citizens: ten per neighbourhood, the right jobs, a home and a workplace of the right kind', () => {
  assert.equal(citizens.length, 50); assert.equal(new Set(citizens.map(c => c.id)).size, 50); assert.equal(new Set(citizens.map(c => c.name)).size, 50);
  for (const q of T.QUARTERS) assert.equal(citizens.filter(c => c.quarter === q.id).length, 10, q.id);
  for (const [role, [n, kind]] of Object.entries(T.ROLES)) {
    const rs = citizens.filter(c => c.role === role); assert.equal(rs.length, n, role);
    for (const c of rs) { assert.equal(c.work.kind, kind, `${c.name} works at a ${kind}`); assert.equal(c.home.kind, 'home'); assert.ok(c.temperament in T.TEMPERAMENTS); }
  }
  assert.equal(citizens.filter(c => c.role === 'mayor').length, 1);
  assert.equal(new Set(citizens.map(c => c.home.id)).size, 50, 'one home each');
});

test('the state is in words: no numbers apart from the announcement, they/them, the announcement quoted, and the claim caveat', () => {
  for (const c of citizens) {
    const s = T.stateFor(c, 'Free food in the square!', 'mayor');
    assert.ok(s.includes(c.name) && s.includes('"Free food in the square!"') && s.includes('Announcements are claims'), c.name);
    assert.ok(!/\d/.test(s), `${c.name}: digits in state: ${s}`);
    assert.ok(!/\b(he|she|his|her|him)\b/i.test(s), `${c.name}: gendered pronoun`);
    assert.match(s, /is an? [a-z ]+ in their [a-z]+\. They are /);
  }
  assert.match(T.stateFor(citizens.find(c => c.role === 'artist'), 'x', 'mayor'), /is an artist/);
  assert.match(T.stateFor(citizens.find(c => c.role === 'baker'), 'x', 'mayor'), /is a baker/);
  assert.match(T.stateFor(citizens[0], 'x', 'stranger'), /a stranger nobody in town has met/);
});

test('the request is one state with three typed questions, every option described', () => {
  const r = T.requestFor(citizens[3], 'Fire at the bakery.', 'fire'), q = r.questions;
  assert.deepEqual(Object.keys(q), ['action', 'place', 'feeling']);
  assert.deepEqual([q.action.type, q.place.type, q.feeling.type], ['choice', 'choice', 'score']);
  assert.deepEqual(Object.keys(q.action.criteria), ['carry_on', 'investigate', 'join_in', 'warn_others']);
  assert.equal(Object.keys(q.place.criteria).length, 12); assert.ok(Object.keys(q.place.criteria).includes('stay'));
  assert.equal(q.feeling.criteria.length, 4);
  for (const v of [...Object.values(q.action.criteria), ...Object.values(q.place.criteria)]) assert.ok(v.length > 12, v);
  assert.ok(JSON.stringify(r).length < 3000);
});

test('a decision is read from the answers, and clamped', () => {
  const d = T.readDecision({ action: { choice: 'investigate', probabilities: { investigate: 0.7 }, confidence: 0.7 }, place: { choice: 'bakery', probabilities: {} }, feeling: { score: 2.4 } });
  assert.deepEqual([d.action, d.place, d.feeling], ['investigate', 'bakery', 2]);
  assert.equal(T.readDecision({ action: { choice: 'carry_on', probabilities: {} }, place: { choice: 'stay', probabilities: {} }, feeling: { score: 9 } }).feeling, 3);
});

test('targets: carrying on goes nowhere, warning goes to a neighbour, places resolve to the nearest one', () => {
  const c = citizens.find(x => x.quarter === 'orchard');
  assert.equal(T.targetFor(town, citizens, c, { action: 'carry_on', place: 'bakery' }), null);
  assert.equal(T.targetFor(town, citizens, c, { action: 'investigate', place: 'stay' }), null);
  assert.equal(T.targetFor(town, citizens, c, { action: 'investigate', place: 'home' }).id, c.home.id);
  const bakery = T.targetFor(town, citizens, c, { action: 'join_in', place: 'bakery' });
  assert.equal(bakery.kind, 'bakery');
  const dist = b => Math.abs(b.x - c.at.access.x) + Math.abs(b.y - c.at.access.y);
  assert.ok(town.buildings.filter(b => b.kind === 'bakery').every(b => dist(bakery) <= dist(b)), 'the nearest bakery');
  const warn = T.targetFor(town, citizens, c, { action: 'warn_others', place: 'stay' });
  assert.equal(warn.kind, 'home'); assert.notEqual(warn.id, c.home.id); assert.equal(warn.quarter, c.quarter);
});

test('tally counts actions, places and feelings of the citizens who decided', () => {
  const cs = citizens.slice(0, 5).map((c, i) => ({ ...c, decision: i < 4 ? { action: ['carry_on', 'investigate', 'investigate', 'warn_others'][i], place: 'bakery', feeling: i } : null }));
  const t = T.tally(cs);
  assert.deepEqual(t.actions, { carry_on: 1, investigate: 2, join_in: 0, warn_others: 1 });
  assert.equal(t.total, 4); assert.equal(t.places.bakery, 4); assert.deepEqual(t.feelings, [1, 1, 1, 1]);
});

test('the town name is one constant and reaches the state', () => {
  assert.equal(T.TOWN_NAME, 'Decida Town');
  assert.ok(T.stateFor(citizens[0], 'x', 'mayor').includes(`in ${T.TOWN_NAME} and`));
  assert.ok(!T.stateFor(citizens[0], 'x', 'mayor').includes('Cloverfield'));
});

test('every preset has a short button label', () => {
  assert.equal(T.PRESET_LABELS.length, T.PRESETS.length);
  for (const l of T.PRESET_LABELS) assert.ok(l.length > 3 && l.length <= 34, l);
});

test('presets and senders are usable', () => {
  assert.ok(T.PRESETS.length >= 4 && T.PRESETS.every(p => p.length > 10));
  assert.ok(Object.values(T.SENDERS).every(s => s.label && s.how));
});

// ---------- mode 2: the model reads, personalities decide ----------
const perceive = (place, danger, offer) => T.readPerception({ place: { choice: place, probabilities: { [place]: 0.9 } }, danger: { noul: danger }, offer: { noul: offer } });

test('the perception request is one shared state with a place, a danger and an offer question', () => {
  const r = T.perceptionRequest('Fire at the bakery.', 'fire');
  assert.match(r.state, /^The fire chief, whose warnings/); assert.ok(r.state.includes('"Fire at the bakery."'));
  assert.deepEqual(Object.keys(r.questions), ['place', 'danger', 'offer']);
  assert.ok(Object.keys(r.questions.place.criteria).includes('none') && Object.keys(r.questions.place.criteria).includes('square'));
  assert.equal(r.questions.danger.type, 'noul');
});

test('the kind of news follows the stronger reading of danger and offer', () => {
  assert.equal(perceive('bakery', 0.92, 0.39).kind, 'danger'); assert.equal(perceive('square', 0.07, 0.91).kind, 'offer');
  assert.equal(perceive('bakery', 0.91, 0.83).kind, 'danger', 'a fire sale mixes both; the stronger reading wins');
  assert.equal(perceive('none', 0.2, 0.3).kind, 'news');
});

const decideAll = (p, sender = 'mayor', salt = 1) => citizens.map(c => ({ c, d: T.decideByRules(c, p, sender, salt) }));
const count = ds => ds.reduce((a, { d }) => { a[d.action]++; return a; }, { carry_on: 0, investigate: 0, join_in: 0, warn_others: 0 });

test('rules are deterministic: the same announcement moves the same people the same way', () => {
  const p = perceive('bakery', 0.92, 0.3);
  assert.deepEqual(decideAll(p).map(x => x.d.action), decideAll(p).map(x => x.d.action));
  assert.notDeepEqual(decideAll(p, 'mayor', 1).map(x => x.d.action), decideAll(p, 'mayor', 2).map(x => x.d.action), 'another announcement, another salt, another mix');
});

test('the town reacts to what the announcement is: danger makes people investigate and warn, an offer makes people join in', () => {
  const danger = count(decideAll(perceive('bakery', 0.92, 0.3))), offer = count(decideAll(perceive('square', 0.05, 0.9))), news = count(decideAll(perceive('none', 0.1, 0.1)));
  assert.ok(danger.warn_others >= 8 && danger.investigate >= 15, JSON.stringify(danger)); assert.equal(danger.join_in, 0);
  assert.ok(offer.join_in >= 12 && offer.warn_others === 0, JSON.stringify(offer));
  assert.ok(news.carry_on >= 35, JSON.stringify(news));
  assert.ok(danger.carry_on < news.carry_on && offer.carry_on < news.carry_on);
});

test('who sent it matters: a stranger is mostly ignored, the fire chief is not', () => {
  const p = perceive('bakery', 0.92, 0.3), stranger = count(decideAll(p, 'stranger')), chief = count(decideAll(p, 'fire'));
  assert.ok(stranger.carry_on > chief.carry_on + 8, `${JSON.stringify(stranger)} vs ${JSON.stringify(chief)}`);
});

test('responders go and look when there is danger, and temperaments show', () => {
  const p = perceive('bakery', 0.92, 0.3), ds = decideAll(p, 'fire');
  const responders = ds.filter(x => ['firefighter', 'nurse', 'doctor'].includes(x.c.role)), goes = responders.filter(x => x.d.action === 'investigate').length;
  assert.ok(goes / responders.length >= 0.6, `${goes} of ${responders.length} responders investigate`);
  const anxious = ds.filter(x => x.c.temperament === 'anxious'), calm = ds.filter(x => x.c.temperament === 'easygoing');
  const warn = a => a.filter(x => x.d.action === 'warn_others').length / a.length;
  assert.ok(warn(anxious) > warn(calm), 'anxious people warn more than easygoing ones');
});

test('decisions carry a place only when they move, a feeling in range, and a reason', () => {
  for (const { c, d } of decideAll(perceive('library', 0.1, 0.9))) {
    assert.ok(['carry_on', 'investigate', 'join_in', 'warn_others'].includes(d.action)); assert.ok(d.feeling >= 0 && d.feeling <= 3); assert.ok(d.why.includes(c.temperament));
    if (d.action === 'carry_on' || d.action === 'warn_others') assert.equal(d.place, 'stay'); else assert.ok(['library', 'stay'].includes(d.place));
    assert.ok(Math.abs(Object.values(d.probs).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
  const d = T.decideByRules(citizens[0], perceive('none', 0.9, 0.1), 'mayor', 3);   // danger with no place named: people head for the square
  if (['investigate', 'join_in'].includes(d.action)) assert.equal(d.place, 'square');
});

test('textSalt differs per text and is stable', () => { assert.equal(T.textSalt('a'), T.textSalt('a')); assert.notEqual(T.textSalt('a'), T.textSalt('b')); });
