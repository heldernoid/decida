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

// suspiciousLink/hostOf only ever receive the defanged form in real use (every href in EMAILS is stored that way),
// so these pass defanged literals too, the same as the actual data does.
test('suspiciousLink: flags a shortener, a raw IP, and a lookalike domain', () => {
  assert.ok(M.suspiciousLink('httpz[:]//bit[.]ly/x9'));
  assert.ok(M.suspiciousLink('httpz[:]//192[.]168[.]1[.]5/login'));
  assert.ok(M.suspiciousLink('httpz[:]//paypal-secure92[.]tk/verify'));
  assert.ok(M.suspiciousLink('httpz[:]//apple-id-verify[.]top/unlock'));
});

test('suspiciousLink: flags text/href mismatch even when the text includes a path', () => {
  const why = M.suspiciousLink('httpz[:]//netflix-update-payment[.]tk/billing', 'netflix.com/account');
  assert.ok(why && why.includes('netflix.com') && why.includes('netflix-update-payment.tk'));
});

test('suspiciousLink: a real link with descriptive button text is not flagged', () => {
  assert.equal(M.suspiciousLink('httpzs[:]//www[.]amazon[.]com/gp/your-account/order-history', 'Track package'), null);
  assert.equal(M.suspiciousLink('httpzs[:]//calendly[.]com/events/9f2a', 'Add to calendar'), null);
  assert.equal(M.suspiciousLink('httpzs[:]//www[.]delta[.]com/checkin', 'Check in now'), null);
});

test('defang: scheme and every dot are broken up so nothing auto-links or pastes as a live URL', () => {
  assert.equal(M.defang('https://google.com'), 'httpzs[:]//google[.]com');
  assert.equal(M.defang('http://bit.ly/claim-prize-now'), 'httpz[:]//bit[.]ly/claim-prize-now');
  assert.equal(M.defang('netflix.com/account'), 'netflix[.]com/account'); // bare text with no scheme: dots still broken
  assert.ok(!M.defang('https://paypal-secure92.tk/verify').includes('http://') && !M.defang('https://paypal-secure92.tk/verify').includes('https://'));
});

test('every link in every email defangs to something with no live scheme or bare dot left', () => {
  const live = /https?:\/\//i;
  for (const e of M.EMAILS) {
    for (const l of e.links || []) {
      assert.ok(!live.test(M.defang(l.href)), `${l.href} still has a live scheme after defanging`);
      assert.ok(!live.test(M.defang(l.text)), `${l.text} still has a live scheme after defanging`);
    }
  }
});

test('every legitimate email’s own links are clean by the same rule used to flag spam ones', () => {
  for (const e of M.EMAILS.filter(e => !e.spam)) {
    for (const l of e.links || []) {
      const why = M.suspiciousLink(l.href, l.text);
      assert.equal(why, null, `${e.subject}: ${l.href} flagged as ${why}`);
    }
  }
});
