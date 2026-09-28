import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../src/decida/web/bench/fraud/transactions.js';

test('60 hand-authored transactions, every category known, a realistic mix of verdicts', () => {
  assert.equal(F.TRANSACTIONS.length, 60);
  const counts = {};
  for (const tx of F.TRANSACTIONS) {
    assert.ok(tx.category in F.CATEGORIES, tx.category);
    assert.ok(tx.merchant && typeof tx.hour === 'number' && tx.hour >= 0 && tx.hour < 24, JSON.stringify(tx));
    if (tx.foreign) assert.ok(tx.country, `foreign transaction missing a country: ${tx.merchant}`);
    else assert.ok(tx.city, `domestic transaction missing a city: ${tx.merchant}`);
    counts[F.oracle(tx)] = (counts[F.oracle(tx)] || 0) + 1;
  }
  assert.ok(counts.approve > counts.decline && counts.decline > 0 && counts.flag > 0, JSON.stringify(counts)); // fraud is rare, but represented
});

test('oracle: a familiar merchant, home country, ordinary amount and hour is always approve', () => {
  const tx = { merchant: 'x', category: 'groceries', amount: 50, typical: 60, familiar: true, timesUsed: 10, foreign: false, city: 'Denver', hour: 12 };
  assert.equal(F.oracle(tx), 'approve');
  assert.equal(F.riskScore(tx), 0);
});

test('oracle: stacking every risk signal is always decline', () => {
  const tx = { merchant: 'x', category: 'wire transfer', amount: 10000, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Nowhere', hour: 2 };
  assert.equal(F.oracle(tx), 'decline');
  assert.ok(F.riskScore(tx) >= 5);
});

test('oracle: exactly one risk signal lands in the flag band, not decline', () => {
  const tx = { merchant: 'Best Buy', category: 'electronics', amount: 300, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 15 };
  assert.equal(F.oracle(tx), 'flag');
});

test('describe: reads as one sentence built only from the structured fields, in words not raw numbers', () => {
  for (const tx of F.TRANSACTIONS) {
    const s = F.describe(tx);
    assert.ok(!s.includes('undefined') && !s.includes('NaN'), s);
    assert.ok(s.includes(tx.merchant) && s.includes(tx.category), s);
    assert.ok(!/\d/.test(s), `describe() must be state-in-words, not raw digits: ${s}`); // encoder models read words far better than magnitudes
  }
});

test('toRequest: one choice question, three options, the state is the description', () => {
  const tx = F.TRANSACTIONS[0], req = F.toRequest(tx);
  assert.equal(req.state, F.describe(tx));
  assert.deepEqual(Object.keys(req.questions.tx.criteria).sort(), ['approve', 'decline', 'flag']);
});

test('scoreVerdict: correct only when the choice matches the oracle', () => {
  const tx = F.TRANSACTIONS.find(t => F.oracle(t) === 'decline');
  assert.equal(F.scoreVerdict(tx, 'decline').correct, true);
  assert.equal(F.scoreVerdict(tx, 'approve').correct, false);
});
