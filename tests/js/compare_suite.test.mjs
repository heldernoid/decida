// The compare bench's labelled set and its scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/decida/web/bench/compare/suite.js';

test('the set is 30 items, 10 per type, with unique ids and a gold answer that exists', () => {
  assert.equal(S.ITEMS.length, 30);
  assert.equal(new Set(S.ITEMS.map(i => i.id)).size, 30);
  for (const kind of ['choice', 'score', 'noul']) assert.equal(S.ITEMS.filter(i => i.kind === kind).length, 10, kind);
  for (const i of S.ITEMS) {
    assert.ok(i.state && i.instructions, i.id);
    if (i.kind === 'choice') { assert.ok(Object.keys(i.criteria).length >= 3, i.id); assert.ok(i.gold in i.criteria, `${i.id}: gold ${i.gold} is an option`); }
    if (i.kind === 'score') { assert.ok(Number.isInteger(i.gold) && i.gold >= 0 && i.gold < i.criteria.length, `${i.id}: gold is a level`); }
    if (i.kind === 'noul') assert.equal(typeof i.gold, 'boolean', i.id);
  }
});

test('the gold answer does not sit in one position: choices and scores use every place, noul is balanced', () => {
  const choicePos = S.ITEMS.filter(i => i.kind === 'choice').map(i => Object.keys(i.criteria).indexOf(i.gold));
  assert.ok(new Set(choicePos).size >= 3, `choice gold positions ${choicePos}`);
  assert.ok(Math.max(...[0, 1, 2, 3].map(p => choicePos.filter(x => x === p).length)) <= 4, 'no position holds more than 4 of 10');
  const scoreGold = S.ITEMS.filter(i => i.kind === 'score').map(i => i.gold);
  assert.ok(new Set(scoreGold).size >= 4, `score gold levels ${scoreGold}`);
  const noul = S.ITEMS.filter(i => i.kind === 'noul').map(i => i.gold);
  assert.equal(noul.filter(Boolean).length, 5);
});

test('every item makes a well-formed request', () => {
  for (const i of S.ITEMS) {
    const r = S.toRequest(i), q = r.questions.q;
    assert.equal(r.state, i.state); assert.equal(q.type, i.kind); assert.equal(q.instructions, i.instructions);
    assert.equal('criteria' in q, i.kind !== 'noul');
  }
});

test('judge reads each answer type in the item terms', () => {
  const ch = S.ITEMS.find(i => i.id === 'route-1');
  assert.deepEqual(S.judge(ch, { choice: 'billing', probabilities: { billing: 0.8, technical: 0.1, sales: 0.1 } }), { predicted: 'billing', confidence: 0.8, correct: true, near: true });
  assert.equal(S.judge(ch, { choice: 'sales', probabilities: { billing: 0.2, technical: 0.1, sales: 0.7 } }).correct, false);
  const sc = S.ITEMS.find(i => i.id === 'urg-1');                                   // gold level 3
  const near = S.judge(sc, { probabilities: { 0: 0.05, 1: 0.05, 2: 0.6, 3: 0.3 } });
  assert.deepEqual([near.predicted, near.correct, near.near], [2, false, true]);
  assert.equal(S.judge(sc, { probabilities: { 0: 0.6, 1: 0.2, 2: 0.1, 3: 0.1 } }).near, false);
  const nu = S.ITEMS.find(i => i.id === 'spam-1');                                  // gold true
  assert.deepEqual([S.judge(nu, { noul: 0.9 }).correct, S.judge(nu, { noul: 0.9 }).confidence], [true, 0.9]);
  const wrong = S.judge(nu, { noul: 0.2 }); assert.equal(wrong.correct, false); assert.ok(Math.abs(wrong.confidence - 0.8) < 1e-9, 'confidence is in what it predicted (false)');
  assert.deepEqual(S.judge(nu, null), { predicted: null, confidence: null, correct: false, near: false });
});

const row = (id, ok, conf, ms, near = ok) => ({ item: S.ITEMS.find(i => i.id === id), result: { predicted: ok ? 'gold' : 'other', confidence: conf, correct: ok, near }, ms, tokens: 100 });

test('summarize: accuracy by type, confidence gap, latency, and errors are not counted as wrong answers', () => {
  const rows = [row('route-1', true, 0.9, 10), row('route-2', false, 0.8, 20), row('urg-1', true, 0.7, 30), row('spam-1', true, 0.6, 40), { item: S.ITEMS[0], error: 'boom' }];
  const s = S.summarize(rows);
  assert.equal(s.n, 5); assert.equal(s.answered, 4); assert.equal(s.errors, 1);
  assert.equal(s.accuracy, 0.75); assert.equal(s.byKind.choice.accuracy, 0.5); assert.equal(s.byKind.score.accuracy, 1); assert.equal(s.byKind.noul.n, 1);
  assert.ok(Math.abs(s.meanConfidence - 0.75) < 1e-9); assert.ok(Math.abs(s.overconfidence) < 1e-9);
  assert.equal(s.confidenceWhenWrong, 0.8); assert.equal(s.tokens, 400);
  assert.equal(s.p50, 30); assert.equal(s.p95, 40);
  assert.equal(S.summarize([]).accuracy, null);
});

test('overconfidence is positive when a model is surer than it is right', () => {
  const s = S.summarize([row('route-1', false, 0.99, 5), row('route-2', false, 0.95, 5), row('route-3', true, 0.9, 5)]);
  assert.ok(s.overconfidence > 0.5);
});

test('agreement counts the same prediction over items both answered', () => {
  const a = [row('route-1', true, 1, 1), row('route-2', true, 1, 1), row('urg-1', true, 1, 1)];
  const b = [row('route-1', true, 1, 1), row('route-2', false, 1, 1), { item: S.ITEMS.find(i => i.id === 'urg-1'), error: 'x' }];
  assert.equal(S.agreement(a, b), 0.5);
  assert.equal(S.agreement([], b), null);
});

test('scenarios are valid requests and topOf reads each type', () => {
  for (const sc of Object.values(S.SCENARIOS)) for (const q of Object.values(sc.questions)) { assert.ok(['choice', 'score', 'noul'].includes(q.type)); assert.equal('criteria' in q, q.type !== 'noul'); }
  assert.equal(S.topOf({ type: 'choice' }, { choice: 'billing' }), 'billing');
  assert.equal(S.topOf({ type: 'score' }, { probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 } }), '1');
  assert.equal(S.topOf({ type: 'noul' }, { noul: 0.3 }), 'no'); assert.equal(S.topOf({ type: 'noul' }, null), null);
});

// ---------- more examples, and my own cases ----------
test('there are thirteen side-by-side examples, all valid, with a mix of question types and distinct labels', () => {
  const list = Object.values(S.SCENARIOS);
  assert.equal(list.length, 13); assert.equal(new Set(list.map(s => s.label)).size, 13);
  for (const sc of list) {
    assert.ok(sc.state.length > 30, sc.label); const qs = Object.values(sc.questions); assert.ok(qs.length >= 2 && qs.length <= 4, sc.label);
    for (const q of qs) {
      assert.ok(['choice', 'score', 'noul'].includes(q.type) && q.instructions.length > 8);
      if (q.type === 'choice') { assert.ok(Object.keys(q.criteria).length >= 2); assert.ok(Object.values(q.criteria).every(v => v.length > 3)); }
      if (q.type === 'score') assert.ok(q.criteria.length >= 2 && new Set(q.criteria).size === q.criteria.length);
    }
  }
  const kinds = new Set(list.flatMap(s => Object.values(s.questions).map(q => q.type))); assert.equal(kinds.size, 3);
});

test('parseOptions reads choices as "name: description" lines and scores as ordered levels', () => {
  assert.deepEqual(S.parseOptions('choice', 'billing: Charges and refunds\n technical : Bugs\nsales').criteria, { billing: 'Charges and refunds', technical: 'Bugs', sales: 'sales' });
  assert.deepEqual(S.parseOptions('score', ' Low\n\nHigh ').criteria, ['Low', 'High']);
  assert.equal(S.parseOptions('noul', 'ignored').criteria, undefined);
  assert.match(S.parseOptions('choice', 'only: one').errors[0], /at least two/);
  assert.match(S.parseOptions('choice', 'a: x\na: y\nb: z').errors[0], /twice/);
  assert.match(S.parseOptions('score', 'Low\nLow').errors[0], /different/);
  assert.match(S.parseOptions('score', 'Only').errors[0], /at least two/);
  assert.match(S.parseOptions('choice', Array.from({ length: 256 }, (_, i) => `o${i}`).join('\n')).errors[0], /at most 255/);
});

test('makeCase validates the state, question, options and gold answer for each type', () => {
  const ok = S.makeCase({ id: 'c1', kind: 'choice', state: ' A leaking pipe. ', instructions: 'Who fixes it?', options: 'plumber: Fixes pipes\nelectrician: Fixes wiring', gold: 'plumber' });
  assert.deepEqual(ok, { id: 'c1', kind: 'choice', state: 'A leaking pipe.', instructions: 'Who fixes it?', criteria: { plumber: 'Fixes pipes', electrician: 'Fixes wiring' }, gold: 'plumber' });
  const sc = S.makeCase({ id: 's', kind: 'score', state: 'x', instructions: 'How bad?', options: 'Fine\nBad\nAwful', gold: '2' }); assert.equal(sc.gold, 2);
  assert.equal(S.makeCase({ id: 'n', kind: 'noul', state: 'x', instructions: 'True?', options: '', gold: 'false' }).gold, false);
  assert.equal(S.makeCase({ id: 'n', kind: 'noul', state: 'x', instructions: 'True?', options: '', gold: true }).gold, true);
  assert.equal('gold' in S.makeCase({ id: 'n', kind: 'noul', state: 'x', instructions: 'True?', options: '' }), false, 'the gold answer is optional');
  const bad = k => S.makeCase({ kind: 'choice', state: 'x', instructions: 'q', options: 'a\nb', gold: 'a', ...k }).errors || [];
  assert.ok(bad({ state: ' ' })[0].includes('state')); assert.ok(bad({ instructions: '' })[0].includes('question'));
  assert.ok(bad({ kind: 'nope' })[0].includes('type')); assert.ok(bad({ gold: 'zzz' })[0].includes('one of the options'));
  assert.ok(S.makeCase({ kind: 'score', state: 'x', instructions: 'q', options: 'a\nb', gold: '5' }).errors[0].includes('one of the levels'));
  assert.ok(S.makeCase({ kind: 'noul', state: 'x', instructions: 'q', options: '', gold: 'maybe' }).errors[0].includes('yes or no'));
  assert.ok(S.makeCase({ kind: 'choice', state: 'x', instructions: 'q', options: 'a\nb', requireGold: true }).errors[0].includes('correct answer'));
});

test('a saved case becomes an example and a scored item that the existing runner accepts', () => {
  const c = S.makeCase({ id: 'c1', kind: 'choice', state: 'A leaking pipe.', instructions: 'Who fixes it?', options: 'plumber: Fixes pipes\nelectrician: Fixes wiring', gold: 'plumber' });
  const sc = S.caseToScenario(c);
  assert.equal(sc.state, c.state); assert.deepEqual(sc.questions.q, { type: 'choice', instructions: 'Who fixes it?', criteria: c.criteria });
  const req = S.toRequest(c); assert.equal(req.questions.q.type, 'choice');
  assert.equal(S.judge(c, { choice: 'plumber', probabilities: { plumber: 0.9, electrician: 0.1 } }).correct, true);
  assert.ok(S.caseToScenario({ ...c, instructions: 'x'.repeat(80) }).label.length <= 44);
  const n = S.makeCase({ id: 'n', kind: 'noul', state: 'x', instructions: 'Is it wet?' });
  assert.equal('criteria' in S.caseToScenario(n).questions.q, false);
});

test('export and import round-trip, keep ids unique, and report bad cases instead of dropping them silently', () => {
  const a = S.makeCase({ id: 'a', kind: 'choice', state: 's', instructions: 'q', options: 'x: X\ny: Y', gold: 'y' }), b = S.makeCase({ id: 'b', kind: 'score', state: 's', instructions: 'q', options: 'lo\nhi', gold: '1' }), c = S.makeCase({ id: 'c', kind: 'noul', state: 's', instructions: 'q', gold: 'true' });
  const back = S.importCases(S.exportCases([a, b, c]));
  assert.deepEqual(back.errors, []); assert.deepEqual(back.cases, [a, b, c]);
  const again = S.importCases(S.exportCases([a]), ['a']); assert.equal(again.cases[0].id, 'a-2');
  const mixed = S.importCases(JSON.stringify([{ kind: 'choice', state: 's', instructions: 'q', criteria: { x: 'X' }, gold: 'x' }, a]));
  assert.equal(mixed.cases.length, 1); assert.match(mixed.errors[0], /Case 1/);
  assert.match(S.importCases('not json').errors[0], /valid JSON/); assert.match(S.importCases('{"x":1}').errors[0], /Expected/);
});
