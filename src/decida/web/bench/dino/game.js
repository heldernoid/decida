// Deterministic Chrome-style dino runner + a forward-simulation planner.
// Pure logic, no DOM: runs in the browser (ES module) and under node for tests.
// Constants follow the public Chromium offline-dino game (BSD-3-Clause): 6 -> 13 speed,
// gravity 0.6, jump velocity 10, obstacle gap rule minGap = w*speed + 120*0.6.

export const W = 600, H = 150, DINO_X = 50, DINO_W = 44, DINO_H = 47, DUCK_W = 59, DUCK_H = 25;
export const SPEED0 = 6, SPEED_MAX = 13, ACCEL = 0.001, GRAVITY = 0.6, JUMP_V = 10, DROP_V = -7;
export const ACTIONS = ['run', 'jump', 'duck'];
const PAD = 2; // hitbox forgiveness in px, like the original

export { rng } from '../common/rng.js';
import { rng } from '../common/rng.js';

const CACTUS = { small: { w: 17, h: 35 }, large: { w: 25, h: 50 } };
const BIRD_Y = { low: 5, mid: 40, high: 75 }; // bottom of the bird above the ground
const BIRD = { w: 46, h: 40 };

export function newGame(seed = 1) {
  return { seed, rand: rng(seed), frame: 0, dist: 0, speed: SPEED0, y: 0, vy: 0, duck: false,
    obstacles: [], nextGap: 0, nextId: 1, crashed: false };
}

export function cloneGame(g) { // rand is not cloned: simulations never spawn obstacles
  return { ...g, obstacles: g.obstacles.map(o => ({ ...o })) };
}

function spawn(g) {
  const last = g.obstacles[g.obstacles.length - 1];
  if (last && last.x + last.w + g.nextGap > W) return;
  const r = g.rand;
  let o;
  if (g.dist > 1500 && r() < 0.25) {
    const level = ['low', 'mid', 'high'][Math.floor(r() * 3)];
    o = { kind: 'bird', level, n: 1, w: BIRD.w, h: BIRD.h, y0: BIRD_Y[level] };
  } else {
    const size = r() < 0.5 ? 'small' : 'large';
    const n = 1 + Math.floor(r() * (g.speed < 8 ? 2 : 3));
    o = { kind: 'cactus', size, n, w: CACTUS[size].w * n, h: CACTUS[size].h, y0: 0 };
  }
  o.x = W + 20;
  o.id = g.nextId++;
  const minGap = o.w * g.speed + 120 * 0.6;
  g.nextGap = minGap + r() * (minGap * 1.5 - minGap);
  g.obstacles.push(o);
}

export function applyAction(g, a) {
  if (a === 'jump') { if (g.y === 0) { g.vy = JUMP_V; } g.duck = false; }
  else if (a === 'duck') { g.duck = true; if (g.y > 0) g.vy = Math.min(g.vy, DROP_V); }
  else { g.duck = false; }
}

export function collides(g) {
  const w = g.duck && g.y === 0 ? DUCK_W : DINO_W, h = g.duck && g.y === 0 ? DUCK_H : DINO_H;
  const x1 = DINO_X + PAD, x2 = DINO_X + w - PAD, y1 = g.y + PAD, y2 = g.y + h - PAD;
  return g.obstacles.some(o => x1 < o.x + o.w && x2 > o.x && y1 < o.y0 + o.h && y2 > o.y0);
}

// One 60 FPS step. spawnObstacles=false is used by the planner's simulations.
export function step(g, spawnObstacles = true) {
  g.frame++;
  g.speed = Math.min(SPEED_MAX, g.speed + ACCEL);
  g.dist += g.speed;
  if (g.y > 0 || g.vy > 0) {
    g.y += g.vy; g.vy -= GRAVITY;
    if (g.y <= 0) { g.y = 0; g.vy = 0; }
  }
  for (const o of g.obstacles) o.x -= g.speed;
  while (g.obstacles.length && g.obstacles[0].x + g.obstacles[0].w < -10) g.obstacles.shift();
  if (spawnObstacles) spawn(g);
  if (collides(g)) g.crashed = true;
  return g;
}

// ---------- planner ----------
export function nextObstacle(g) {
  return g.obstacles.find(o => o.x + o.w > DINO_X - 4) || null;
}

export function describe(o) {
  if (o.kind === 'bird') return `${o.level} bird`;
  return `${o.n} ${o.size} ${o.n > 1 ? 'cacti' : 'cactus'}`;
}

// Score a sequence of timed actions [{t, a}] (t = frames from now): how many of the offsets -2..2 applied to
// every t get past the next obstacle without a collision (0 = always hits, 5 = robust).
export function robustSeq(g, seq, lookahead = true) {
  const target = nextObstacle(g);
  if (!target) return 5;
  let ok = 0;
  for (let d = -2; d <= 2; d++) {
    const s = cloneGame(g);
    const times = seq.map(x => ({ t: Math.max(0, x.t + d), a: x.a }));
    let hit = false;
    for (let f = 0; f < 240 && !hit; f++) {
      for (const x of times) if (x.t === f) applyAction(s, x.a);
      step(s, false);
      if (s.crashed) { hit = true; break; }
      const t = s.obstacles.find(o => o.id === target.id);
      if (!t || t.x + t.w < DINO_X - 6) break; // target passed
    }
    if (!hit && lookahead && !canClearNext(s)) hit = true; // survived this one but is doomed at the next
    if (!hit) ok++;
  }
  return ok;
}

// Depth-2 lookahead: from state s (target just passed), can some single action clear the next obstacle?
function canClearNext(s) {
  const next = nextObstacle(s);
  if (!next || next.x - (DINO_X + DINO_W) > 350) return true;
  for (const a of ['run', 'jump', 'duck']) {
    for (let d = 0; d <= 48; d += a === 'run' ? 100 : 4) {
      const c = cloneGame(s);
      let hit = false;
      for (let f = 0; f < 240 && !hit; f++) {
        if (f === d) applyAction(c, a);
        step(c, false);
        if (c.crashed) { hit = true; break; }
        const t = c.obstacles.find(o => o.id === next.id);
        if (!t || t.x + t.w < DINO_X - 6) break;
      }
      if (!hit) return true;
    }
  }
  return false;
}
export const robustness = (g, action, lat) => robustSeq(g, [{ t: lat, a: action }]);

// `every` is how often the game asks. Waiting (running on) is only safe if a jump or duck can still clear
// the obstacle at a frame the game will actually get to act on: lat + k * every.
export const SAFE_MIN = 3; // an action is safe if 3 of the 5 latency offsets survive
export const WAIT_MIN = 5; // waiting is only promised while the later escape survives all 5 (it has no margin to spare)
export function plan(g, lat, every = 6) {
  const target = nextObstacle(g);
  const scores = {};
  for (const a of ACTIONS) scores[a] = robustness(g, a, lat);
  let wait = false;
  if (scores.run < SAFE_MIN && target) {
    for (let d = every + lat; d <= 90 && !wait; d += every) {
      for (const a of ['jump', 'duck']) if (robustSeq(g, [{ t: lat, a: 'run' }, { t: d, a }]) >= WAIT_MIN) wait = true;
    }
    if (wait) scores.run = SAFE_MIN;
  }
  const safe = ACTIONS.filter(a => scores[a] >= SAFE_MIN);
  const order = { run: 0, duck: 1, jump: 2 }; // prefer the least disruptive among equals
  const best = (safe.length ? safe : ACTIONS).slice().sort((x, y) => scores[y] - scores[x] || order[x] - order[y])[0];
  return { target, scores, safe, best, wait };
}

// The TypeSafe-shaped request for the current moment.
// hints: 'full' = Safe/Unsafe + Best marker (as upstream ships it), 'nobest' = Safe/Unsafe only,
// 'none' = neutral descriptions, the model must judge from distances and speed alone.
export function toRequest(g, lat, every = 6, hints = 'full') {
  const p = plan(g, lat, every);
  const t = p.target;
  const dist = t ? Math.max(0, Math.round(t.x - (DINO_X + DINO_W))) : null;
  const far = !t || dist > 420;
  const state = far ? 'Dino runner game. Nothing ahead, clear track.'
    : `Dino runner game. ${describe(t)} ahead, ${dist} px away.` + (hints === 'none' ? ` Speed ${g.speed.toFixed(1)} px per frame.` : '');
  const criteria = {};
  for (const a of ACTIONS) {
    const ok = p.safe.includes(a);
    const best = hints === 'full' && a === p.best ? ' Best.' : '';
    let txt;
    if (hints === 'none') {
      txt = far ? (a === 'run' ? 'Keep running.' : a === 'jump' ? 'Jump now.' : 'Duck now.')
        : a === 'run' ? `Keep running toward the ${describe(t)}.` : a === 'jump' ? `Jump now to go over the ${describe(t)}.` : `Duck now to go under the ${describe(t)}.`;
    } else if (far) txt = a === 'run' ? `Safe. Clear track.${best}` : 'Safe. Wastes time.';
    else if (a === 'run' && p.wait && ok) txt = `Safe. Too early to act on the ${describe(t)}.${best}`;
    else if (!ok) txt = `Unsafe. Hits the ${describe(t)}. Collision.`;
    else {
      const verb = a === 'jump' ? `Clears the ${describe(t)}.` : a === 'duck' ? `Passes under the ${describe(t)}.` : `Passes the ${describe(t)}.`;
      txt = `Safe. ${verb}${best}`;
    }
    criteria[a] = txt;
  }
  return { request: { state, questions: { action: { type: 'choice', instructions: 'Choose the best safe action for the dinosaur.', criteria } } }, plan: p };
}
