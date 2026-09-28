import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../src/decida/web/bench/news/news.js';

test('50 hand-written events, a mix of directions, every field present', () => {
  assert.equal(N.EVENTS.length, 50);
  const counts = {};
  for (const ev of N.EVENTS) {
    assert.ok(ev.company && ev.ticker && ev.category && ev.wire && ev.social, JSON.stringify(ev));
    assert.ok(N.DIRECTIONS.includes(ev.direction), ev.direction);
    counts[ev.direction] = (counts[ev.direction] || 0) + 1;
  }
  assert.ok(counts.buy > 0 && counts.sell > 0 && counts.hold > 0, JSON.stringify(counts));
});

test('describe: carries both the wire headline and the social reaction, labelled separately', () => {
  const ev = N.EVENTS[0], s = N.describe(ev);
  assert.ok(s.includes(ev.wire));
  assert.ok(s.includes(ev.social));
  assert.ok(s.includes('Social media reaction'));
});

test('toRequest: one choice question, three options, state is the full description', () => {
  const ev = N.EVENTS[0], req = N.toRequest(ev);
  assert.equal(req.state, N.describe(ev));
  assert.deepEqual(Object.keys(req.questions.call.criteria).sort(), ['buy', 'hold', 'sell']);
});

test('oracle: is exactly the event’s own authored direction, not derived or guessed', () => {
  for (const ev of N.EVENTS) assert.equal(N.oracle(ev), ev.direction);
});

test('company names are fictional, not real public companies, so nothing here reads as real trading advice', () => {
  const real = ['Apple', 'Tesla', 'Amazon', 'Google', 'Microsoft', 'Meta', 'Nvidia', 'Netflix'];
  const names = new Set(N.EVENTS.map(e => e.company));
  for (const r of real) assert.ok(![...names].some(n => n.includes(r)), `${r} looks like a real company name`);
});
