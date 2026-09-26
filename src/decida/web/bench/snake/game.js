// Snake on a small grid with full information, plus a BFS / flood-fill oracle that labels each move.
// Pure logic, no DOM: runs in the browser (ES module) and under node for tests.
import { rng } from '../common/rng.js';

export const MOVES = ['up', 'down', 'left', 'right'];
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const key = (x, y) => y * 64 + x;

export function newGame(seed = 1, size = 10) {
  const mid = Math.floor(size / 2);
  const g = { seed, size, rand: rng(seed), snake: [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }],
    food: null, score: 0, moves: 0, dead: false, cause: null, won: false };
  placeFood(g);
  return g;
}

export function cloneGame(g) { return { ...g, snake: g.snake.map(c => ({ ...c })), food: g.food && { ...g.food } }; }

function placeFood(g) {
  const taken = new Set(g.snake.map(c => key(c.x, c.y)));
  const free = [];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!taken.has(key(x, y))) free.push({ x, y });
  if (!free.length) { g.food = null; g.won = true; return; }
  g.food = free[Math.floor(g.rand() * free.length)];
}

const inside = (g, x, y) => x >= 0 && y >= 0 && x < g.size && y < g.size;

// Advance one move. Returns g. A move into a wall or the body ends the game (the tail cell is free unless eating).
export function step(g, move) {
  if (g.dead || g.won) return g;
  const [dx, dy] = DIRS[move];
  const head = g.snake[0], nx = head.x + dx, ny = head.y + dy;
  g.moves++;
  if (!inside(g, nx, ny)) { g.dead = true; g.cause = 'wall'; return g; }
  const eating = !!g.food && g.food.x === nx && g.food.y === ny;
  const body = g.snake.slice(0, eating ? g.snake.length : g.snake.length - 1);
  if (body.some(c => c.x === nx && c.y === ny)) { g.dead = true; g.cause = 'body'; return g; }
  g.snake.unshift({ x: nx, y: ny });
  if (eating) { g.score++; placeFood(g); } else g.snake.pop();
  return g;
}

// ---------- oracle ----------
function occupiedAfter(g, nh, eating) {
  const keep = eating ? g.snake : g.snake.slice(0, -1);
  return new Set([key(nh.x, nh.y), ...keep.map(c => key(c.x, c.y))]);
}

function flood(g, start, occupied) { // free cells reachable from start (start itself is occupied by the head)
  const seen = new Set([key(start.x, start.y)]), q = [start];
  let n = 0;
  while (q.length) {
    const c = q.shift();
    for (const m of MOVES) {
      const x = c.x + DIRS[m][0], y = c.y + DIRS[m][1], k = key(x, y);
      if (inside(g, x, y) && !seen.has(k) && !occupied.has(k)) { seen.add(k); q.push({ x, y }); n++; }
    }
  }
  return n;
}

function bfsDist(g, from, to, occupied) { // shortest path length through free cells; Infinity if none
  if (!to) return Infinity;
  if (from.x === to.x && from.y === to.y) return 0;
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [from], d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    for (const c of frontier) for (const m of MOVES) {
      const x = c.x + DIRS[m][0], y = c.y + DIRS[m][1], k = key(x, y);
      if (!inside(g, x, y) || seen.has(k) || occupied.has(k)) continue;
      if (x === to.x && y === to.y) return d;
      seen.add(k); next.push({ x, y });
    }
    frontier = next;
  }
  return Infinity;
}

export function evaluate(g, move) {
  const head = g.snake[0], nh = { x: head.x + DIRS[move][0], y: head.y + DIRS[move][1] };
  if (!inside(g, nh.x, nh.y)) return { move, status: 'fatal', cause: 'wall' };
  const eating = !!g.food && g.food.x === nh.x && g.food.y === nh.y;
  const bodyNow = g.snake.slice(0, eating ? g.snake.length : g.snake.length - 1);
  if (bodyNow.some(c => c.x === nh.x && c.y === nh.y)) return { move, status: 'fatal', cause: 'body' };
  const occ = occupiedAfter(g, nh, eating);
  const area = flood(g, nh, occ), length = g.snake.length + (eating ? 1 : 0);
  const dist = eating ? 0 : bfsDist(g, nh, g.food, occ);
  return { move, status: area < length ? 'risky' : 'safe', area, dist, eating };
}

// Label all four moves and pick the best: safe with the shortest path to the food, then the most room.
export function plan(g) {
  const evals = Object.fromEntries(MOVES.map(m => [m, evaluate(g, m)]));
  const cur = bfsDist(g, g.snake[0], g.food, new Set(g.snake.slice(0, -1).map(c => key(c.x, c.y))));
  const rank = arr => arr.slice().sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || b.area - a.area || MOVES.indexOf(a.move) - MOVES.indexOf(b.move));
  const safe = MOVES.filter(m => evals[m].status === 'safe');
  const risky = MOVES.filter(m => evals[m].status === 'risky');
  let best;
  if (safe.length) best = rank(safe.map(m => evals[m]))[0].move;
  else if (risky.length) best = risky.map(m => evals[m]).sort((a, b) => b.area - a.area)[0].move;
  else best = 'up';
  return { evals, best, safe, cur };
}

// ---------- request ----------
export function board(g) {
  const rows = [];
  for (let y = 0; y < g.size; y++) {
    let r = '';
    for (let x = 0; x < g.size; x++) {
      const i = g.snake.findIndex(c => c.x === x && c.y === y);
      r += i === 0 ? 'H' : i > 0 ? 'o' : g.food && g.food.x === x && g.food.y === y ? 'F' : '.';
    }
    rows.push(r);
  }
  return rows.join('\n');
}

const rel = (d, neg, pos) => d === 0 ? null : d < 0 ? `${-d} ${neg}` : `${d} ${pos}`;

// hints: 'none' = raw board and neutral options, 'nobest' = feature description with Safe/Risky/Unsafe labels,
// 'full' = the same plus one Best marker (as upstream ships it).
export function toRequest(g, hints = 'full') {
  const p = plan(g);
  const head = g.snake[0], n = g.size;
  const criteria = {};
  for (const m of MOVES) {
    const e = p.evals[m];
    let txt;
    if (hints === 'none') txt = `Move ${m}.`;
    else {
      const best = hints === 'full' && m === p.best ? ' Best.' : '';
      if (e.status === 'fatal') txt = `Unsafe. Hits ${e.cause === 'wall' ? 'the wall' : 'its own body'}.`;
      else if (e.status === 'risky') txt = `Risky. Traps the snake in a pocket of ${e.area} free cells.${best}`;
      else if (e.eating) txt = `Safe. Eats the food.${best}`;
      else txt = `Safe. ${e.dist < p.cur ? `Gets closer to the food (${e.dist} step${e.dist === 1 ? '' : 's'}).` : 'Moves away from the food.'}${best}`;
    }
    criteria[m] = txt;
  }
  let state;
  if (hints === 'none') {
    state = `Snake game on a ${n}x${n} grid, snake length ${g.snake.length}. H = head, o = body, F = food, . = empty. Row 0 is the top.\n${board(g)}`;
  } else {
    const f = g.food, dx = f.x - head.x, dy = f.y - head.y;
    const where = [rel(dx, 'left', 'right'), rel(dy, 'up', 'down')].filter(Boolean).join(', ');
    state = `Snake game on a ${n}x${n} grid, snake length ${g.snake.length}. Head at (${head.x},${head.y}). Food at (${f.x},${f.y}): ${where || 'on the head'}.`;
  }
  return { request: { state, questions: { move: { type: 'choice', instructions: 'Which way should the snake move?', criteria } } }, plan: p };
}
