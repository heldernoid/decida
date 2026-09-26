// AI Town: the town, its citizens, and how one announcement becomes fifty typed decisions. Pure logic, no DOM: runs in the browser and under node.
//
// The town is fixed and deterministic (same seed, same town): a 26x26 tile grid of five neighbourhoods around a central square, streets on
// a regular grid, and every amenity (bakery, clinic, fire station, park, and in the middle the library, town hall, cinema, school and
// market) sitting on a street. Fifty citizens live in it, each with a home, a job and a temperament. When the mayor (or anyone) makes an
// announcement, every citizen is asked the same typed questions about it, in words, and the answers decide what they do next.
//
// Lessons from the other benches, applied: the state says who the citizen is and what they were doing in words, never numbers; the questions
// ask what this person will do, and every option carries a description; the code, not the model, moves people along the streets.
import { rng } from '../common/rng.js';

export const TOWN_NAME = 'Decida Town';        // the one place the town's name is set
export const N = 26;
export const LINES = [0, 5, 10, 15, 20, 25];            // streets run along these rows and columns
export const QUARTERS = [
  { id: 'willow', name: 'Willow Quarter', anchor: [2, 0.2] },
  { id: 'orchard', name: 'Orchard Quarter', anchor: [0.2, 2] },
  { id: 'sunrise', name: 'Sunrise Quarter', anchor: [3.8, 1.6] },
  { id: 'harbor', name: 'Harbor Quarter', anchor: [3, 3.8] },
  { id: 'ridge', name: 'Ridge Quarter', anchor: [0.8, 3.6] },
];
// What kinds of place exist: how each reads in a sentence and what it is called.
export const KINDS = {
  home: { name: 'home', desc: 'their own home' },
  bakery: { name: 'the bakery', desc: 'the bakery: bread, pastries and coffee' },
  clinic: { name: 'the clinic', desc: 'the clinic: doctors and nurses' },
  fire: { name: 'the fire station', desc: 'the fire station: firefighters and their engines' },
  park: { name: 'the park', desc: 'the park: benches, trees and a pond' },
  library: { name: 'the library', desc: 'the library: books and quiet reading rooms' },
  cinema: { name: 'the entertainment centre', desc: 'the entertainment centre: films and shows' },
  school: { name: 'the school', desc: 'the school: classrooms and a playground' },
  market: { name: 'the market', desc: 'the market: stalls with fruit, vegetables and everyday goods' },
  hall: { name: 'the town hall', desc: 'the town hall: the mayor and the town offices' },
  square: { name: 'Fountain Square', desc: 'Fountain Square: the open square in the middle of town' },
};
const AMENITY_KINDS = ['bakery', 'clinic', 'fire', 'park'];         // one of each in every neighbourhood
const CENTRE_RING = ['garden', 'hall', 'garden', 'tree', 'library', 'tree', 'market', 'market', 'garden', 'tree', 'cinema', 'school'];

const ringSlots = () => {   // the twelve tiles around the edge of a 4x4 block, clockwise from the top-left
  const s = [];
  for (let x = 0; x < 4; x++) s.push([x, 0]);
  for (let y = 1; y < 3; y++) s.push([3, y]);
  for (let x = 3; x >= 0; x--) s.push([x, 3]);
  for (let y = 2; y >= 1; y--) s.push([0, y]);
  return s;
};

export const isRoad = (x, y) => x >= 0 && y >= 0 && x < N && y < N && (LINES.includes(x) || LINES.includes(y));
export const idx = (x, y) => x + y * N;

function quarterOf(bx, by) {
  if (bx === 2 && by === 2) return 'centre';
  let best = null, bd = 1e9;
  for (const q of QUARTERS) { const d = (bx - q.anchor[0]) ** 2 + (by - q.anchor[1]) ** 2; if (d < bd) { bd = d; best = q.id; } }
  return best;
}

// A road tile next to a building tile, on the side facing the street the tile sits on.
function accessFor(tx, ty) {
  const cand = [[tx, ty - 1, 'n'], [tx + 1, ty, 'e'], [tx, ty + 1, 's'], [tx - 1, ty, 'w']].filter(([x, y]) => isRoad(x, y));
  return { x: cand[0][0], y: cand[0][1], side: cand[0][2] };
}

export function buildTown(seed = 7) {
  const R = rng(seed);
  const tiles = Array.from({ length: N * N }, (_, i) => ({ kind: isRoad(i % N, Math.floor(i / N)) ? 'road' : 'grass' }));
  const blocks = [], buildings = [];
  for (let by = 0; by < 5; by++) for (let bx = 0; bx < 5; bx++) blocks.push({ bx, by, ox: 1 + 5 * bx, oy: 1 + 5 * by, quarter: quarterOf(bx, by), taken: new Set() });
  const inQuarter = id => blocks.filter(b => b.quarter === id);
  const place = (b, slot, kind, name) => {
    const [dx, dy] = ringSlots()[slot], x = b.ox + dx, y = b.oy + dy;
    tiles[idx(x, y)] = { kind, quarter: b.quarter };
    b.taken.add(slot);
    if (name) { const bld = { id: `${kind}-${buildings.length}`, kind, name, quarter: b.quarter, x, y, access: accessFor(x, y) }; buildings.push(bld); return bld; }
    return null;
  };
  const qname = id => (QUARTERS.find(q => q.id === id) || { name: 'Town centre' }).name.replace(' Quarter', '');
  // the middle: a square with a fountain, ringed by the shared amenities
  const centre = blocks.find(b => b.quarter === 'centre');
  CENTRE_RING.forEach((k, slot) => {
    if (['tree', 'garden'].includes(k)) { const [dx, dy] = ringSlots()[slot]; tiles[idx(centre.ox + dx, centre.oy + dy)] = { kind: k, quarter: 'centre' }; centre.taken.add(slot); }
    else place(centre, slot, k, k === 'hall' ? 'Town Hall' : k === 'library' ? 'Library' : k === 'cinema' ? 'Entertainment Centre' : k === 'school' ? 'School' : 'Market');
  });
  for (let dy = 1; dy < 3; dy++) for (let dx = 1; dx < 3; dx++) tiles[idx(centre.ox + dx, centre.oy + dy)] = { kind: 'square', quarter: 'centre' };
  buildings.push({ id: 'square-0', kind: 'square', name: 'Fountain Square', quarter: 'centre', x: centre.ox + 1, y: centre.oy + 1, access: { x: centre.ox + 1, y: centre.oy - 1, side: 'n' } });
  // each neighbourhood gets its bakery, clinic, fire station and park, in different blocks where it can
  for (const q of QUARTERS) {
    const bs = inQuarter(q.id);
    AMENITY_KINDS.forEach((kind, k) => {
      const b = bs[(k + Math.floor(R() * bs.length)) % bs.length];
      const free = ringSlots().map((_, i) => i).filter(i => !b.taken.has(i));
      const slot = free[Math.floor(R() * free.length)];
      const nm = kind === 'bakery' ? `${qname(q.id)} Bakery` : kind === 'clinic' ? `${qname(q.id)} Clinic` : kind === 'fire' ? `${qname(q.id)} Fire Station` : `${qname(q.id)} Park`;
      place(b, slot, kind, nm);
      if (kind === 'park') for (let dy = 1; dy < 3; dy++) for (let dx = 1; dx < 3; dx++) tiles[idx(b.ox + dx, b.oy + dy)] = { kind: 'parkground', quarter: q.id };
    });
  }
  // everything else: houses, trees, gardens and open grass
  let homeNo = 0;
  for (const b of blocks) {
    ringSlots().forEach((_, slot) => {
      if (b.taken.has(slot)) return;
      const r = R(), [dx, dy] = ringSlots()[slot], x = b.ox + dx, y = b.oy + dy;
      if (r < 0.4) { tiles[idx(x, y)] = { kind: 'home', quarter: b.quarter, variant: Math.floor(R() * 4) }; buildings.push({ id: `home-${homeNo++}`, kind: 'home', name: `${qname(b.quarter)} home ${homeNo}`, quarter: b.quarter, x, y, access: accessFor(x, y), variant: tiles[idx(x, y)].variant }); }
      else tiles[idx(x, y)] = { kind: r < 0.62 ? 'tree' : r < 0.78 ? 'garden' : 'grass', quarter: b.quarter };
    });
    for (let dy = 1; dy < 3; dy++) for (let dx = 1; dx < 3; dx++) {
      const t = tiles[idx(b.ox + dx, b.oy + dy)]; if (t.kind !== 'grass' || b.quarter === 'centre') continue;
      const r = R(); tiles[idx(b.ox + dx, b.oy + dy)] = { kind: r < 0.5 ? 'tree' : r < 0.72 ? 'garden' : 'grass', quarter: b.quarter };
    }
  }
  return { seed, size: N, tiles, blocks: blocks.map(({ taken, ...b }) => b), buildings, quarters: QUARTERS };
}

// ---------- streets ----------
export function roadPath(from, to) {   // shortest walk along the streets between two road tiles (BFS); [] if there is none
  const key = (x, y) => x + y * N, start = key(from.x, from.y), goal = key(to.x, to.y);
  if (start === goal) return [{ x: from.x, y: from.y }];
  const prev = new Map([[start, -1]]), q = [start];
  while (q.length) {
    const cur = q.shift(), cx = cur % N, cy = Math.floor(cur / N);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
      if (!isRoad(nx, ny) || prev.has(k)) continue;
      prev.set(k, cur);
      if (k === goal) { const out = []; for (let c = k; c !== -1; c = prev.get(c)) out.push({ x: c % N, y: Math.floor(c / N) }); return out.reverse(); }
      q.push(k);
    }
  }
  return [];
}

// ---------- citizens ----------
const NAMES = ['Maya', 'Tobias', 'Ines', 'Kofi', 'Lena', 'Rafael', 'Suki', 'Omar', 'Hannah', 'Dev', 'Clara', 'Mateo', 'Nadia', 'Felix', 'Amara', 'Jonas', 'Priya', 'Leo', 'Zara', 'Anton',
  'Mei', 'Bruno', 'Yara', 'Oscar', 'Ingrid', 'Tariq', 'Elsa', 'Kai', 'Sofia', 'Ravi', 'Greta', 'Noah', 'Aisha', 'Emil', 'Lucia', 'Hugo', 'Freya', 'Jamal', 'Petra', 'Ivan', 'Nora', 'Samir', 'Alma', 'Theo', 'Rosa', 'Idris', 'Wren', 'Milo', 'Dara', 'Otto'];
export const TEMPERAMENTS = {
  cautious: 'cautious and like to check things before acting',
  curious: 'curious and drawn to anything unusual',
  easygoing: 'easygoing and rarely bothered by news',
  sociable: 'sociable and always talking with neighbours',
  sceptical: 'sceptical and slow to believe announcements',
  anxious: 'anxious and quick to worry',
  brave: 'brave and ready to step in when something happens',
};
// role: [how many, where they work, how old, the sentence for what they are doing at work, likely temperaments]
export const ROLES = {
  baker: [4, 'bakery', 'thirties', 'serving customers and pulling loaves from the oven', ['easygoing', 'cautious']],
  nurse: [3, 'clinic', 'thirties', 'seeing patients', ['cautious', 'brave', 'sociable']],
  doctor: [2, 'clinic', 'forties', 'seeing patients', ['cautious', 'sceptical']],
  firefighter: [5, 'fire', 'thirties', 'checking the engine and the gear', ['brave', 'brave', 'cautious']],
  teacher: [4, 'school', 'forties', 'teaching a class', ['cautious', 'sociable', 'curious']],
  student: [8, 'school', 'teens', 'sitting in class', ['curious', 'sociable', 'easygoing', 'anxious']],
  librarian: [2, 'library', 'fifties', 'shelving books', ['cautious', 'sceptical']],
  shopkeeper: [4, 'market', 'forties', 'tending a stall', ['sociable', 'easygoing', 'sceptical']],
  'cinema worker': [2, 'cinema', 'twenties', 'selling tickets', ['easygoing', 'curious']],
  clerk: [2, 'hall', 'thirties', 'filing papers', ['cautious', 'sceptical']],
  gardener: [3, 'park', 'fifties', 'watering the flower beds', ['easygoing', 'sociable']],
  artist: [1, 'park', 'twenties', 'sketching by the pond', ['curious']],
  reporter: [1, 'hall', 'thirties', 'taking notes for the town paper', ['curious', 'sceptical']],
  mayor: [1, 'hall', 'sixties', 'reading reports in the mayor\'s office', ['cautious']],
  retiree: [8, 'park', 'seventies', 'sitting on a bench', ['easygoing', 'sociable', 'sceptical', 'anxious']],
};
const SKIN = ['#f1c8a5', '#e0a97f', '#c98b5e', '#8d5a3b', '#5a3a26'];
const SHIRT = { baker: '#f2a65a', nurse: '#5fb3a1', doctor: '#4e8fc4', firefighter: '#d64545', teacher: '#7a6bb8', student: '#f2c94c', librarian: '#8a6d4b', shopkeeper: '#6fae5c', 'cinema worker': '#b0508a', clerk: '#7b8794', gardener: '#4f9d5b', artist: '#e07a9a', reporter: '#3d6fa8', mayor: '#1f4d3a', retiree: '#c9b28a' };
const HAIR = ['#2b2118', '#5a3a26', '#a9743f', '#d9b36c', '#8a8a8a', '#c0392b'];

function nearest(list, from) { let best = null, bd = 1e9; for (const b of list) { const d = Math.abs(b.x - from.x) + Math.abs(b.y - from.y); if (d < bd) { bd = d; best = b; } } return best; }

export function makeCitizens(town, seed = 11) {
  const R = rng(seed), homes = town.buildings.filter(b => b.kind === 'home');
  // spread the fifty homes over the five neighbourhoods evenly
  const byQ = Object.fromEntries(QUARTERS.map(q => [q.id, homes.filter(h => h.quarter === q.id)]));
  const picked = [];
  for (let round = 0; picked.length < 50; round++) for (const q of QUARTERS) { const h = byQ[q.id][round]; if (h && picked.length < 50) picked.push(h); }
  const roles = Object.entries(ROLES).flatMap(([role, [n]]) => Array.from({ length: n }, () => role));
  for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [roles[i], roles[j]] = [roles[j], roles[i]]; }
  const names = [...NAMES];
  return picked.map((home, i) => {
    const role = roles[i], [, kind, age, doing, temps] = ROLES[role], temperament = temps[Math.floor(R() * temps.length)];
    const sameQ = town.buildings.filter(b => b.kind === kind && (kind === 'hall' || b.quarter === home.quarter));
    const work = nearest(sameQ.length ? sameQ : town.buildings.filter(b => b.kind === kind), home) || home;
    const start = role === 'retiree' && R() < 0.4 ? home : work;
    return { id: i, name: names[i % names.length], role, age, temperament, doing, home, work, quarter: home.quarter,
      look: { skin: SKIN[Math.floor(R() * SKIN.length)], hair: HAIR[Math.floor(R() * HAIR.length)], shirt: SHIRT[role] },
      x: start.access.x, y: start.access.y, at: start, activity: 'routine', decision: null };
  });
}

// ---------- the announcement ----------
export const SENDERS = {
  mayor: { label: 'The mayor', how: 'the mayor, whom most residents trust' },
  fire: { label: 'The fire chief', how: 'the fire chief, whose warnings residents usually take seriously' },
  paper: { label: 'The town newspaper', how: 'the town newspaper, which residents read every morning but which sometimes exaggerates' },
  neighbour: { label: 'A neighbour', how: 'a neighbour, someone the resident knows a little' },
  stranger: { label: 'A stranger', how: 'a stranger nobody in town has met' },
};
export const PRESETS = [
  'Free food in the town square. Everyone welcome!',
  'Free food in the town square, but leave your house unlocked.',
  'Fire sale at the bakery. Everything must go!',
  'Fire at the bakery.',
  'Everyone who does not go to the fountain will be bitten by a poisonous snake.',
  'The library is giving away every book today.',
  'A film premiere starts at the entertainment centre in ten minutes.',
  'Stay indoors until further notice.',
];
// Short names for the buttons under the composer, in the same order as PRESETS.
export const PRESET_LABELS = ['Free food in the square', '...but leave your house unlocked', 'Fire sale at the bakery', 'Fire at the bakery', 'Snake at the fountain', 'Free books at the library', 'Film premiere', 'Stay indoors'];


// what someone is doing in words, for the state: at work, at home, or out and about
export const placeName = b => (b.quarter === 'centre' && b.kind !== 'square' ? `the ${b.name}` : b.name);
function whatTheyAreDoing(c) {
  const where = c.at ? placeName(c.at) : 'the streets';
  if (c.activity === 'walking') return `walking through ${(QUARTERS.find(q => q.id === c.quarter) || { name: 'town' }).name}`;
  if (c.at && c.at.kind === 'home') return `at home in ${(QUARTERS.find(q => q.id === c.at.quarter) || { name: 'town' }).name}`;
  return `${c.doing} at ${where}`;
}
export const PART_OF_DAY = 'mid-afternoon';

// The state for one citizen: who they are, what they are doing, and what they have just heard. Words only. Citizens are "they".
export function stateFor(c, announcement, sender = 'mayor') {
  const article = /^[aeiou]/i.test(c.role) ? 'an' : 'a';
  return `${c.name} is ${article} ${c.role} in their ${c.age}. They are ${TEMPERAMENTS[c.temperament]}. `
    + `It is a quiet ${PART_OF_DAY} in ${TOWN_NAME} and ${c.name} is ${whatTheyAreDoing(c)}. `
    + `Just now, ${SENDERS[sender].how}, announced to the whole town: "${announcement.trim()}" `
    + `Announcements are claims, not verified facts: ${c.name} only knows what was said.`;
}

export const ACTIONS = {
  carry_on: 'Carry on with what they were doing: this does not change their plans',
  investigate: 'Go and check for themselves what is happening before doing anything else',
  join_in: 'Take part: go to where it is happening and join in',
  warn_others: 'Warn their neighbours and friends about it and tell them what to do',
};
export const ACTION_LABEL = { carry_on: 'carry on', investigate: 'investigate', join_in: 'join in', warn_others: 'warn others' };
export const FEELINGS = ['Calm', 'Curious', 'Worried', 'Alarmed'];
const DEST_KEYS = ['bakery', 'clinic', 'fire', 'park', 'library', 'cinema', 'school', 'market', 'hall', 'square', 'home'];
export const DESTINATIONS = { ...Object.fromEntries(DEST_KEYS.map(k => [k, KINDS[k].desc.replace(/^./, s => s.toUpperCase())])), stay: 'Stay exactly where they are' };

// The three typed questions every citizen answers, in ONE request.
export function requestFor(c, announcement, sender = 'mayor') {
  return { state: stateFor(c, announcement, sender), questions: {
    action: { type: 'choice', instructions: `What will ${c.name} do about the announcement?`, criteria: ACTIONS },
    place: { type: 'choice', instructions: `Where will ${c.name} go next?`, criteria: DESTINATIONS },
    feeling: { type: 'score', instructions: `How does ${c.name} feel about the announcement?`, criteria: FEELINGS },
  } };
}

// Read one citizen's answers into a decision. `answers` is the response's `answers` object.
export function readDecision(answers) {
  const a = answers.action, p = answers.place, f = answers.feeling;
  const feeling = f ? Math.max(0, Math.min(3, Math.round(f.score))) : 0;
  return { action: a.choice, place: p ? p.choice : 'stay', feeling, actionProbs: a.probabilities, placeProbs: p ? p.probabilities : {}, confidence: a.confidence };
}

// Where the citizen heads, given their decision: a building, or null when they carry on.
export function targetFor(town, citizens, c, d) {
  if (d.action === 'carry_on') return null;
  if (d.action === 'warn_others') {   // the nearest neighbour who lives in the same quarter
    const others = citizens.filter(o => o.id !== c.id && o.quarter === c.quarter);
    const n = nearest(others.map(o => ({ ...o.home, citizen: o })), c.at ? c.at.access : c);
    return n ? n.citizen.home : null;
  }
  if (d.place === 'stay') return null;
  if (d.place === 'home') return c.home;
  const list = town.buildings.filter(b => b.kind === d.place);
  return nearest(list, c.at ? c.at.access : c) || null;
}

// The counts the timer card shows: how many chose each action, where they are heading, how they feel.
export function tally(citizens) {
  const out = { total: 0, actions: { carry_on: 0, investigate: 0, join_in: 0, warn_others: 0 }, places: {}, feelings: [0, 0, 0, 0] };
  for (const c of citizens) {
    if (!c.decision) continue;
    out.total++; out.actions[c.decision.action]++;
    out.places[c.decision.place] = (out.places[c.decision.place] || 0) + 1;
    out.feelings[c.decision.feeling]++;
  }
  return out;
}

// ---------- mode 2: the model reads the announcement once, personalities decide ----------
// Small models read text well but do not tell one person's reaction from another's (measured: their per-person answers follow the person's
// job, not the announcement). So in this mode the model is asked, ONCE for the whole town, what the announcement is about, and every
// citizen's temperament, job and trust in the sender turn that into an action through the rules below.
export const TRUST = { mayor: 0.8, fire: 0.9, paper: 0.55, neighbour: 0.5, stranger: 0.15 };
export const PERCEPTION_PLACES = { ...Object.fromEntries(DEST_KEYS.map(k => [k, DESTINATIONS[k]])), none: 'No particular place is mentioned' };

export function perceptionRequest(announcement, sender = 'mayor') {
  const how = SENDERS[sender].how;
  return { state: `${how.replace(/^./, s => s.toUpperCase())} announced to the whole town: "${announcement.trim()}"`, questions: {
    place: { type: 'choice', instructions: 'Which place in town does the announcement point to?', criteria: PERCEPTION_PLACES },
    danger: { type: 'noul', instructions: 'Does the announcement warn of a danger or an emergency?' },
    offer: { type: 'noul', instructions: 'Does the announcement offer something that people would want to go and get or enjoy?' },
  } };
}

export function readPerception(answers) {
  const p = answers.place;
  const place = p.choice, danger = answers.danger.noul, offer = answers.offer.noul;
  const kind = danger >= 0.5 && danger >= offer ? 'danger' : offer >= 0.5 ? 'offer' : 'news';   // "Fire sale" mixes both; the stronger reading wins
  return { place, placeProb: (p.probabilities || {})[place] ?? 0, danger, offer, kind, placeProbs: p.probabilities || {} };
}

// How likely each action is, by kind of news and temperament (each row sums to 1: carry_on, investigate, join_in, warn_others).
const PROPENSITY = {
  danger: { brave: [0.1, 0.7, 0, 0.2], anxious: [0.2, 0.2, 0, 0.6], cautious: [0.2, 0.5, 0, 0.3], curious: [0.1, 0.8, 0, 0.1], sociable: [0.1, 0.3, 0, 0.6], sceptical: [0.5, 0.4, 0, 0.1], easygoing: [0.5, 0.3, 0, 0.2] },
  offer: { sociable: [0.1, 0.2, 0.7, 0], curious: [0.1, 0.3, 0.6, 0], easygoing: [0.5, 0.1, 0.4, 0], brave: [0.5, 0.2, 0.3, 0], cautious: [0.4, 0.5, 0.1, 0], sceptical: [0.6, 0.3, 0.1, 0], anxious: [0.5, 0.4, 0.1, 0] },
  news: { sociable: [0.55, 0.1, 0.05, 0.3], curious: [0.6, 0.3, 0.1, 0], easygoing: [0.9, 0.05, 0.05, 0], brave: [0.85, 0.1, 0.05, 0], cautious: [0.7, 0.3, 0, 0], sceptical: [0.85, 0.15, 0, 0], anxious: [0.6, 0.2, 0, 0.2] },
};
const RESPONDERS = ['firefighter', 'nurse', 'doctor'];
const hash01 = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const textSalt = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const ACTION_ORDER = ['carry_on', 'investigate', 'join_in', 'warn_others'];

// One citizen's decision from what the model read. Deterministic: the same announcement always moves the same people the same way.
export function decideByRules(c, perception, sender, salt = 0) {
  const trust = TRUST[sender] ?? 0.5, kind = perception.kind, place = perception.place;
  const concerned = place !== 'none' && (c.work.kind === place || c.home.kind === place) || (kind === 'danger' && RESPONDERS.includes(c.role) && (place === 'none' || ['fire', 'clinic', 'bakery', 'square', 'market'].includes(place)));
  let w = [...PROPENSITY[kind][c.temperament]];
  const act = 0.35 + 0.9 * trust + (concerned ? 0.4 : 0);                       // how much more likely they are to do something than to ignore it
  w = [w[0] / Math.max(0.25, act), w[1] * act, w[2] * act, w[3] * act];
  if (kind === 'danger' && RESPONDERS.includes(c.role)) { w[1] *= 3; w[0] *= 0.3; }   // responders go and look
  const sum = w.reduce((a, b) => a + b, 0), u = hash01(c.id + 1, salt);
  let acc = 0, action = 'carry_on';
  for (let i = 0; i < 4; i++) { acc += w[i] / sum; if (u < acc) { action = ACTION_ORDER[i]; break; } }
  const target = kind === 'danger' && place === 'none' ? 'square' : place;
  const dest = action === 'investigate' || action === 'join_in' ? (target === 'none' ? 'stay' : target) : 'stay';
  const feeling = kind === 'danger' ? (trust >= 0.5 ? (c.temperament === 'anxious' ? 3 : c.temperament === 'brave' ? 1 : 2) : 1) : kind === 'offer' ? (action === 'join_in' ? 1 : 0) : 0;
  const why = `${c.temperament} ${c.role}${concerned ? ', concerned' : ''}; ${kind}${place !== 'none' ? ` at ${place}` : ''}; trust in sender ${trust >= 0.7 ? 'high' : trust >= 0.4 ? 'middling' : 'low'}`;
  return { action, place: dest, feeling, why, probs: Object.fromEntries(ACTION_ORDER.map((a, i) => [a, w[i] / sum])) };
}
