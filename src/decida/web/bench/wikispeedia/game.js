// Wikispeedia bench logic: turn "which link next?" into typed questions, and read the answers back.
// Pure: no DOM, no fetch of its own (the caller passes `post`), so it runs in the browser and under node.
//
// Design lessons applied (measured in the other benches): the state says in words where we are and where we want to go;
// questions ask what the text says ("would this article mention the goal?"), not what to do; every option carries a
// description; a choice never has more than ~8 options; code, not the model, does the measuring, ranking and stopping.

// Measured (DecidaBERT-large and, as a diagnostic, Jev): asking how related a page is to the goal ranks links about as well as chance,
// asking whether the page would MENTION the goal ranks them clearly better, because a link that gets closer is one whose
// page leads on to the goal.
export const LEVELS = ['almost never', 'rarely', 'sometimes', 'often', 'always or nearly always'];
export const STRATEGIES = ['two-stage', 'score', 'tournament'];
// What the model is told. lead: the goal's first sentences plus the current page's lead (the first design).
// goal: a fuller goal profile and only the current page's name, since the choice is about how each link relates to the goal.
// hub: goal + says in words which links are broad overview pages. peek: hub + what each link leads to (a human only learns
// that by opening the page, so results with peek are labelled assisted).
// titles: goal profile, but links are just their names (an ablation: do summaries help at all?).
export const DESIGNS = ['lead', 'goal', 'hub', 'peek', 'titles'];
export const MAX_QUESTIONS = 256;      // per request, as the wire format allows
const SHORTLIST = 8, GROUP = 8, OPTION_CHARS = 150;   // DecidaBERT-large reads 2142 tokens, so options carry a full description; serve with --max-len 2142 --head-tokens 1400

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '...');
const tag = (l, hints) => (hints === 'category' && l.category ? ` [${l.category}]` : '');

// What the model is told about the situation. Words only.
export function stateText(article, goal, design = 'lead') {
  const aim = goal.category ? ` (${goal.category})` : '', where = article.category ? ` (${article.category})` : '';
  if (design === 'lead') {
    return `We are playing a navigation game on an encyclopedia. The goal page is "${goal.title}"${aim}. ${clip(goal.summary, 260)} `
      + `We are now reading the page "${article.title}"${where}. ${clip(article.lead, 420)}`;
  }
  return `We are playing a navigation game on an encyclopedia. The goal page is "${goal.title}"${aim}. ${clip(goal.lead || goal.summary, 480)} `
    + `We are now on the page "${article.title}"${where} and want to click the link that gets closest to the goal.`;
}

// One line describing a link, as it appears in questions and options.
export function linkLine(l, hints, design = 'lead', goal = null) {
  const hub = (design === 'hub' || design === 'peek') && l.hub ? ' (a broad overview page)' : '';
  let peek = '';
  if (design === 'peek' && l.leads_to && l.leads_to.length) {
    const direct = goal && l.leads_to.includes(goal.title) ? ' It links directly to the goal page.' : '';
    peek = `${direct} It links to: ${l.leads_to.slice(0, 8).join(', ')}.`;
  }
  if (design === 'titles') return `${l.title}${tag(l, hints)}`;
  return `${l.title}${tag(l, hints)}${hub}: ${clip(l.summary, 150)}${peek}`;
}

// A short description for one option of a choice: what the page is, plus (by design) hub-ness and a direct link to the goal.
export function optionText(l, hints, design = 'lead', goal = null) {
  const flags = [];
  if ((design === 'hub' || design === 'peek') && l.hub) flags.push('broad overview page');
  if (design === 'peek' && goal && l.leads_to && l.leads_to.includes(goal.title)) flags.push('links directly to the goal page');
  if (design === 'titles') return l.category || l.title;
  return `${flags.length ? flags.join(', ') + '. ' : ''}${clip(l.summary, OPTION_CHARS)}${tag(l, hints)}`;
}

// Score every link separately: "how often would this article mention the goal?", answered on five levels. Chunked to the wire limit.
export function scoreRequests(article, goal, links, { hints = 'none', design = 'lead' } = {}) {
  const state = stateText(article, goal, design), out = [];
  for (let lo = 0; lo < links.length; lo += MAX_QUESTIONS) {
    const chunk = links.slice(lo, lo + MAX_QUESTIONS), questions = {}, ids = {};
    chunk.forEach((l, i) => {
      const id = `l${lo + i}`; ids[id] = l;
      questions[id] = { type: 'score', instructions: `How often would the article "${linkLine(l, hints, design, goal)}" mention the goal page "${goal.title}"?`, criteria: LEVELS };
    });
    out.push({ request: { state, questions }, ids });
  }
  return out;
}

// One choice among a handful of pages: the answer is a distribution over them.
export function choiceRequest(article, goal, links, { hints = 'none', design = 'lead' } = {}) {
  const criteria = {};
  for (const l of links) criteria[l.title] = optionText(l, hints, design, goal);
  return { state: stateText(article, goal, design), questions: { pick: { type: 'choice', instructions: `Which of these articles would be the most likely to mention the goal page "${goal.title}"?`, criteria } } };
}

// Best-first by expected level; ties keep the page's own link order so a run is reproducible.
export function rankByScore(scored) {
  return scored.map((s, i) => ({ ...s, i })).sort((a, b) => b.score - a.score || a.i - b.i);
}

const groups = (list, n) => { const g = []; for (let i = 0; i < list.length; i += n) g.push(list.slice(i, i + n)); return g; };

// Decide the next click. `post(request)` resolves to { json, ms }. Returns the pick and everything the monitor needs.
export async function decideHop(post, { article, goal, links, strategy = 'two-stage', hints = 'none', design = 'lead' }) {
  if (!links.length) return { pick: null, ranking: [], calls: [], last: null };
  const calls = [], record = (request, r) => { calls.push({ request, ms: r.ms, tokens: (r.json.usage && r.json.usage.input_tokens) || 0, json: r.json }); return r.json; };
  if (links.length === 1) return { pick: links[0], ranking: [{ title: links[0].title, score: 4 }], calls, last: null };

  const finalChoice = async pool => {
    const req = choiceRequest(article, goal, pool, { hints, design }), a = record(req, await post(req)).answers.pick;
    return { pick: pool.find(l => l.title === a.choice) || pool[0], answer: a, request: req };
  };

  if (strategy === 'tournament') {
    let pool = links;
    while (pool.length > 1) {
      const gs = groups(pool, GROUP), reqs = gs.map(g => choiceRequest(article, goal, g, { hints, design }));
      const rs = await Promise.all(reqs.map(async (q, i) => ({ g: gs[i], q, r: await post(q) })));
      const winners = rs.map(({ g, q, r }) => { const a = record(q, r).answers.pick; return { l: g.find(x => x.title === a.choice) || g[0], a, q }; });
      if (winners.length === 1) { const w = winners[0]; return { pick: w.l, ranking: Object.entries(w.a.probabilities).map(([title, p]) => ({ title, score: p })).sort((x, y) => y.score - x.score), calls, last: w }; }
      pool = winners.map(w => w.l);
    }
  }

  const scored = [];
  for (const { request, ids } of scoreRequests(article, goal, links, { hints, design })) {
    const ans = record(request, await post(request)).answers;
    for (const [id, l] of Object.entries(ids)) scored.push({ title: l.title, score: ans[id].score, link: l });
  }
  const ranking = rankByScore(scored);
  if (strategy === 'score') return { pick: ranking[0].link, ranking, calls, last: null };
  const top = ranking.slice(0, SHORTLIST).map(r => r.link), f = await finalChoice(top);
  return { pick: f.pick, ranking: Object.entries(f.answer.probabilities).map(([title, p]) => ({ title, score: p })).sort((a, b) => b.score - a.score), calls, last: { a: f.answer, q: f.request }, scored: ranking };
}

// How the click changed the shortest way to the goal, from the dataset's own distances (never shown to the model).
export function judge(currentHops, pickHops) {
  if (pickHops == null) return 'lost';               // no route to the goal from there
  if (currentHops == null) return 'lost';
  if (pickHops < currentHops) return 'closer';
  return pickHops === currentHops ? 'same' : 'farther';
}

export function newRun(start, goal, hops, maxClicks) {
  return { start, goal, hops, maxClicks, path: [start], visited: new Set([start]), clicks: 0, status: 'playing', judged: [] };
}

// Apply a click. Wins on reaching the goal, loses when out of clicks or with nowhere new to go.
export function click(run, title, verdict) {
  run.path.push(title); run.visited.add(title); run.clicks++; run.judged.push(verdict);
  if (title === run.goal) run.status = 'won';
  else if (run.clicks >= run.maxClicks) run.status = 'out of clicks';
  return run;
}

export const options = (view, run) => view.links.filter(l => !run.visited.has(l.title));
