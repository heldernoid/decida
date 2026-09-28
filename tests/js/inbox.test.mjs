import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/decida/web/bench/inbox/mail.js';

test('exactly 100 emails, exactly 25 spam, every subject and snippet non-empty', () => {
  assert.equal(M.EMAILS.length, 100);
  assert.equal(M.EMAILS.filter(e => e.spam).length, 25);
  for (const e of M.EMAILS) {
    assert.ok(e.from && e.subject && e.snippet && e.body, JSON.stringify(e));
    assert.equal(typeof e.spam, 'boolean');
  }
});

test('toRequest: one noul question per email, well under the batch limit', () => {
  const req = M.toRequest();
  assert.equal(Object.keys(req.questions).length, 100);
  assert.ok(Object.values(req.questions).every(q => q.type === 'noul' && q.instructions.includes('Is this email spam?')));
});

test('sortMail: files by the model’s own answer, and scores against the known ground truth', () => {
  const answers = {};
  M.EMAILS.forEach((e, i) => { answers[`m${i}`] = { noul: e.spam ? 0.9 : 0.1 }; }); // a perfect model
  const r = M.sortMail(M.EMAILS, answers);
  assert.equal(r.junk.length, 25);
  assert.equal(r.inbox.length, 75);
  assert.equal(r.accuracy, 1);
  assert.equal(r.falsePos, 0);
  assert.equal(r.falseNeg, 0);
});

test('sortMail: a model that says "no" to everything gets scored, not silently hidden', () => {
  const answers = {};
  M.EMAILS.forEach((_, i) => { answers[`m${i}`] = { noul: 0.1 }; }); // always "not spam"
  const r = M.sortMail(M.EMAILS, answers);
  assert.equal(r.junk.length, 0);
  assert.equal(r.falseNeg, 25); // every spam email reached the inbox
  assert.equal(r.falsePos, 0);
  assert.equal(r.accuracy, 0.75);
});

test('suspiciousLink: flags a shortener, a raw IP, and a lookalike domain', () => {
  assert.ok(M.suspiciousLink('http://bit.ly/x9'));
  assert.ok(M.suspiciousLink('http://192.168.1.5/login'));
  assert.ok(M.suspiciousLink('http://paypal-secure92.tk/verify'));
  assert.ok(M.suspiciousLink('http://apple-id-verify.top/unlock'));
});

test('suspiciousLink: flags text/href mismatch even when the text includes a path', () => {
  const why = M.suspiciousLink('http://netflix-update-payment.tk/billing', 'netflix.com/account');
  assert.ok(why && why.includes('netflix.com') && why.includes('netflix-update-payment.tk'));
});

test('suspiciousLink: a real link with descriptive button text is not flagged', () => {
  assert.equal(M.suspiciousLink('https://www.amazon.com/gp/your-account/order-history', 'Track package'), null);
  assert.equal(M.suspiciousLink('https://calendly.com/events/9f2a', 'Add to calendar'), null);
  assert.equal(M.suspiciousLink('https://www.delta.com/checkin', 'Check in now'), null);
});

test('every legitimate email’s own links are clean by the same rule used to flag spam ones', () => {
  for (const e of M.EMAILS.filter(e => !e.spam)) {
    for (const l of e.links || []) {
      const why = M.suspiciousLink(l.href, l.text);
      assert.equal(why, null, `${e.subject}: ${l.href} flagged as ${why}`);
    }
  }
});
