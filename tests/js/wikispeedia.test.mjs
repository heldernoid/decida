// Wikispeedia bench logic: request shapes, strategies with a mock model, and the oracle bookkeeping.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../src/decida/web/bench/wikispeedia/game.js';

const mk = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ title: `Page ${i}`, summary: `About page ${i}. It has a second sentence.`, category: i % 2 ? 'Science > Physics' : 'Art', hops_to_target: 987650 + i, ...extra }));
const article = { title: 'Here', category: 'Geography', lead: 'Here is a place. '.repeat(40), hops_to_target: 987654 };
const goal = { title: 'The Goal', category: 'Science', summary: 'The goal is a thing that is described in a sentence.' };

// A mock model that likes higher page numbers: score = page index mod 5, choice = the highest page number among the options.
function mockPost(log = []) {
  return async request => {
    log.push(request);
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === 'score') { const n = +/Page (\d+)/.exec(q.instructions)[1]; answers[id] = { type: 'score', score: (n % 5) + (n / 1000), probabilities: [.2, .2, .2, .2, .2] }; }
      else {
        const keys = Object.keys(q.criteria), best = keys.reduce((a, b) => (+b.split(' ')[1] > +a.split(' ')[1] ? b : a));
        answers[id] = { type: 'choice', choice: best, probabilities: Object.fromEntries(keys.map(k => [k, k === best ? .5 : .5 / (keys.length - 1)])) };
      }
    }
    return { json: { answers, usage: { input_tokens: 100 } }, ms: 10 };
  };
}

test('state says goal and place in words, and never carries the oracle distances', () => {
  const s = G.stateText(article, goal);
  assert.match(s, /goal page is "The Goal"/); assert.match(s, /reading the page "Here"/);
  assert.ok(s.length < 1200);
  const reqs = G.scoreRequests(article, goal, mk(5));
  assert.ok(!JSON.stringify(reqs.map(r => r.request)).includes('98765'), 'hops_to_target must never reach the model');
  assert.ok(!JSON.stringify(G.choiceRequest(article, goal, mk(5))).includes('98765'));
});

test('score requests: one question per link, five levels, chunked at the wire limit', () => {
  const links = mk(300), reqs = G.scoreRequests(article, goal, links);
  assert.equal(reqs.length, 2);
  assert.equal(Object.keys(reqs[0].request.questions).length, 256); assert.equal(Object.keys(reqs[1].request.questions).length, 44);
  const q = reqs[0].request.questions.l3;
  assert.equal(q.type, 'score'); assert.deepEqual(q.criteria, G.LEVELS); assert.match(q.instructions, /Page 3: About page 3/);
  assert.equal(reqs[1].ids.l299.title, 'Page 299');
});

test('hints=category adds the subject to the description, none does not', () => {
  const l = mk(2);
  assert.ok(!G.choiceRequest(article, goal, l).questions.pick.criteria['Page 1'].includes('Physics'));
  assert.ok(G.choiceRequest(article, goal, l, { hints: 'category' }).questions.pick.criteria['Page 1'].includes('Physics'));
});

test('score strategy: one request, best expected level wins, ties keep link order', async () => {
  const log = [], links = mk(30), r = await G.decideHop(mockPost(log), { article, goal, links, strategy: 'score' });
  assert.equal(log.length, 1); assert.equal(r.pick.title, 'Page 29');   // 29 % 5 = 4 and the largest index among the 4s
  assert.equal(G.rankByScore([{ title: 'a', score: 1 }, { title: 'b', score: 1 }])[0].title, 'a');
});

test('two-stage: score everything, then one choice among the top eight', async () => {
  const log = [], r = await G.decideHop(mockPost(log), { article, goal, links: mk(40), strategy: 'two-stage' });
  assert.equal(log.length, 2); assert.equal(log[1].questions.pick && Object.keys(log[1].questions.pick.criteria).length, 8);
  assert.equal(r.pick.title, 'Page 39'); assert.equal(r.ranking[0].title, 'Page 39'); assert.ok(r.last.a.choice);
  assert.equal(r.calls.length, 2);
});

test('tournament: no choice ever has more than eight options, and it ends with one winner', async () => {
  const log = [], r = await G.decideHop(mockPost(log), { article, goal, links: mk(75), strategy: 'tournament' });
  for (const q of log) assert.ok(Object.keys(q.questions.pick.criteria).length <= 8);
  assert.equal(r.pick.title, 'Page 74'); assert.ok(log.length >= 10 + 2 + 1);   // 10 groups, then 2, then the final
});

test('a single option needs no model call, and no options gives no pick', async () => {
  const log = [];
  assert.equal((await G.decideHop(mockPost(log), { article, goal, links: mk(1) })).pick.title, 'Page 0'); assert.equal(log.length, 0);
  assert.equal((await G.decideHop(mockPost(log), { article, goal, links: [] })).pick, null);
});

test('judge compares distances from the dataset', () => {
  assert.equal(G.judge(3, 2), 'closer'); assert.equal(G.judge(3, 3), 'same'); assert.equal(G.judge(3, 4), 'farther');
  assert.equal(G.judge(3, null), 'lost'); assert.equal(G.judge(null, 2), 'lost');
});

test('run: visited pages are not offered, reaching the goal wins, running out of clicks loses', () => {
  const run = G.newRun('A', 'Z', 3, 2);
  const view = { links: [{ title: 'A' }, { title: 'B' }, { title: 'Z' }] };
  assert.deepEqual(G.options(view, run).map(l => l.title), ['B', 'Z']);
  G.click(run, 'B', 'closer'); assert.equal(run.status, 'playing'); assert.equal(run.clicks, 1);
  assert.deepEqual(G.options(view, run).map(l => l.title), ['Z']);
  G.click(run, 'C', 'same'); assert.equal(run.status, 'out of clicks');
  const win = G.newRun('A', 'Z', 1, 5); G.click(win, 'Z', 'closer'); assert.equal(win.status, 'won');
});

test('choice options stay bounded whatever the design', () => {
  const long = mk(6).map(l => ({ ...l, summary: 'A very long description sentence that keeps going and going far past any sensible option length for a choice. '.repeat(3), hub: true, leads_to: ['Page 1', 'The Goal', 'Page 3', 'Page 4', 'Page 5', 'Page 6', 'Page 7', 'Page 8', 'Page 9'] }));
  for (const design of G.DESIGNS) {
    const c = G.choiceRequest(article, goal, long, { design }).questions.pick.criteria;
    for (const v of Object.values(c)) assert.ok(v.length <= 150 + 80, `${design}: ${v.length}`);
  }
  assert.match(G.choiceRequest(article, goal, long, { design: 'peek' }).questions.pick.criteria['Page 0'], /links directly to the goal page/);
  assert.ok(!/links directly/.test(G.choiceRequest(article, goal, long, { design: 'hub' }).questions.pick.criteria['Page 0']));
});

test('designs differ where they should: lead carries the current page text, goal does not, peek lists what a link leads to', () => {
  const a = { ...article, lead: 'UNIQUE-LEAD-TEXT is here.' }, g = { ...goal, lead: 'The goal lead paragraph, longer than the summary.' };
  assert.match(G.stateText(a, g, 'lead'), /UNIQUE-LEAD-TEXT/); assert.ok(!G.stateText(a, g, 'goal').includes('UNIQUE-LEAD-TEXT'));
  assert.match(G.stateText(a, g, 'goal'), /goal lead paragraph/);
  const l = { ...mk(1)[0], hub: true, leads_to: ['Alpha', 'The Goal'] };
  assert.ok(!G.linkLine(l, 'none', 'goal', g).includes('overview')); assert.match(G.linkLine(l, 'none', 'hub', g), /broad overview page/);
  assert.match(G.linkLine(l, 'none', 'peek', g), /links directly to the goal page\. It links to: Alpha, The Goal/);
});
