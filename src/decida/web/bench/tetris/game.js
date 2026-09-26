// Tetris engine shared by live.js: board (10x20), the 7 pieces and their rotations, a seeded 7-bag, line clearing and
// scoring, board features (holes, bumpiness, heights) and a heuristic that ranks every final resting placement of a piece
// (the oracle behind live.js). Pure logic, no DOM: runs in the browser (ES module) and under node for tests.
import { rng } from '../common/rng.js';

export const COLS = 10, ROWS = 20;
export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const BASE = { // cells as [x, y] in a small box, y down
  I: [[0, 0], [1, 0], [2, 0], [3, 0]], O: [[0, 0], [1, 0], [0, 1], [1, 1]], T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
export const LINE_SCORE = [0, 40, 100, 300, 1200];

const norm = cells => { const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1])); return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]); };
const rotate = cells => norm(cells.map(([x, y]) => [-y, x]));

// Distinct rotations of a piece, in a stable order (rotation 0 is the spawn orientation).
export const ROTATIONS = Object.fromEntries(PIECES.map(p => {
  const seen = new Set(), out = [];
  let c = norm(BASE[p]);
  for (let i = 0; i < 4; i++) { const k = JSON.stringify(c); if (!seen.has(k)) { seen.add(k); out.push(c); } c = rotate(c); }
  return [p, out];
}));

// Human names for each distinct rotation (index = rotation), checked against the drawings by a test.
const ORIENT = { I: ['flat', 'upright'], O: ['square'], T: ['pointing down', 'pointing left', 'pointing up', 'pointing right'],
  S: ['flat', 'upright'], Z: ['flat', 'upright'],
  J: ['flat, hook up-left', 'upright, hook top-right', 'flat, hook down-right', 'upright, hook bottom-left'],
  L: ['flat, hook up-right', 'upright, hook bottom-right', 'flat, hook down-left', 'upright, hook top-left'] };
export const orientName = (piece, rot) => ORIENT[piece][rot];
export function shapeArt(piece, rot) { // e.g. T pointing down -> "###/.#."
  const c = ROTATIONS[piece][rot], w = Math.max(...c.map(v => v[0])) + 1, h = Math.max(...c.map(v => v[1])) + 1, rows = [];
  for (let y = 0; y < h; y++) rows.push(Array.from({ length: w }, (_, x) => (c.some(v => v[0] === x && v[1] === y) ? '#' : '.')).join(''));
  return rows.join('/');
}

export function newGame(seed = 1) {
  const g = { seed, rand: rng(seed), board: Array.from({ length: ROWS }, () => Array(COLS).fill(0)), bag: [], piece: null, next: null,
    lines: 0, score: 0, pieces: 0, over: false };
  g.piece = draw(g); g.next = draw(g);
  return g;
}

export function draw(g) { // 7-bag: every piece exactly once per bag
  if (!g.bag.length) {
    const bag = PIECES.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(g.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    g.bag = bag;
  }
  return g.bag.pop();
}

export const fits = (board, cells, x, y) => cells.every(([cx, cy]) => { const bx = x + cx, by = y + cy; return bx >= 0 && bx < COLS && by < ROWS && (by < 0 || !board[by][bx]); });

// ---------- features ----------
export function features(board) {
  const heights = Array(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let top = -1;
    for (let y = 0; y < ROWS; y++) if (board[y][x]) { top = y; break; }
    if (top >= 0) { heights[x] = ROWS - top; for (let y = top + 1; y < ROWS; y++) if (!board[y][x]) holes++; }
  }
  let bump = 0;
  for (let x = 0; x < COLS - 1; x++) bump += Math.abs(heights[x] - heights[x + 1]);
  return { heights, holes, bump, agg: heights.reduce((a, b) => a + b, 0), max: Math.max(...heights) };
}

// Board after locking `cells` at (x, y) and clearing full rows; also returns how many rows cleared.
export function lock(board, cells, x, y, id = 1) {
  const b = board.map(r => r.slice());
  for (const [cx, cy] of cells) b[y + cy][x + cx] = id;
  const kept = b.filter(r => !r.every(Boolean)), cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(0));
  return { board: kept, cleared };
}

// Every distinct resting placement for `piece`: rotation x column, dropped straight down.
export function placements(g, piece = g.piece) {
  const out = [];
  ROTATIONS[piece].forEach((cells, rot) => {
    const w = Math.max(...cells.map(c => c[0])) + 1;
    for (let x = 0; x <= COLS - w; x++) {
      if (!fits(g.board, cells, x, 0)) continue; // no room to spawn here
      let y = 0;
      while (fits(g.board, cells, x, y + 1)) y++;
      const { board, cleared } = lock(g.board, cells, x, y);
      const f = features(board);
      out.push({ id: `${ORIENT[piece][rot].replace(/[ ,]+/g, '-')}@${x}`, name: ORIENT[piece][rot], piece, rot, x, y, w, cells, cleared, holes: f.holes, bump: f.bump, agg: f.agg, max: f.max,
        value: -0.510066 * f.agg + 0.760666 * cleared - 0.35663 * f.holes - 0.184483 * f.bump, board });
    }
  });
  return out;
}

export function plan(g) {
  const all = placements(g);
  const ranked = all.slice().sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  return { all, ranked, best: ranked[0] ? ranked[0].id : null };
}
