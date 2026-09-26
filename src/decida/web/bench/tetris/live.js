// Live Tetris, adapted from the design of Agent (JEV) playing Tetris: https://github.com/Yasserbhb/Agent-JEV-Tetris
// (no licence file in that repo; used here by the project owner's decision, with attribution, see THIRD_PARTY.md).
// Ideas taken from it: a falling piece with wall-clock gravity, a small action set where every option carries a
// computed preview of its outcome, one best plan instead of per-direction hints, only offering legal moves, a
// landing-shadow ('+') in the board text, and a per-piece history summary. The code below is our own implementation.
//
// Live Tetris: one piece falls under gravity while the model chooses an action each turn
// (left, right, turn, soft drop, hard drop, wait). Built on the placement engine in game.js.
// Every option the model sees carries a computed preview of where the piece would land, so the model judges
// consequences instead of counting cells. Pure logic, no DOM: runs in the browser and under node.
import * as P from './game.js';

export const MOVES = ['left', 'right', 'rotate_cw', 'rotate_ccw', 'soft_drop', 'hard_drop', 'wait'];
const KICK_DX = [0, -1, 1, -2, 2, -3, 3], KICK_DY = [0, -1, -2];

export const cellsOf = c => P.ROTATIONS[c.k][c.rot];
export const cellsAbs = c => cellsOf(c).map(([x, y]) => [c.x + x, c.y + y]);
const widthOf = c => Math.max(...cellsOf(c).map(v => v[0])) + 1;
const heightOf = c => Math.max(...cellsOf(c).map(v => v[1])) + 1;
const fitsAt = (g, c) => P.fits(g.board, cellsOf(c), c.x, c.y);

export function newLive(seed = 1) {
  const g = P.newGame(seed);
  g.pieceId = 0;
  spawn(g);
  return g;
}

function spawn(g) {
  const cur = { k: g.piece, rot: 0, x: 0, y: 0 };
  cur.x = Math.floor((P.COLS - widthOf(cur)) / 2);
  g.cur = cur; g.trail = []; g.pieceId++;
  if (!fitsAt(g, cur)) g.over = true;
}

export function dropY(g, c = g.cur) {
  let y = c.y;
  while (P.fits(g.board, cellsOf(c), c.x, y + 1)) y++;
  return y;
}

function lockCurrent(g) {
  const c = g.cur, { board, cleared } = P.lock(g.board, cellsOf(c), c.x, dropY(g, c), c.k);
  g.board = board; g.lines += cleared; g.pieces++;
  g.score += P.LINE_SCORE[cleared] * (Math.floor(g.lines / 10) + 1);
  g.piece = g.next; g.next = P.draw(g);
  spawn(g);
  return cleared;
}

// The piece after `move`, or null when the move cannot be made (a wall or block is in the way, or there is nothing to turn).
function moved(g, move) {
  const c = g.cur;
  switch (move) {
    case 'left': case 'right': { const q = { ...c, x: c.x + (move === 'left' ? -1 : 1) }; return fitsAt(g, q) ? q : null; }
    case 'rotate_cw': case 'rotate_ccw': {
      const n = P.ROTATIONS[c.k].length;
      if (n === 1 || (move === 'rotate_ccw' && n === 2)) return null; // turning the other way gives the same shape
      const rot = (c.rot + (move === 'rotate_cw' ? 1 : n - 1)) % n;
      for (const dy of KICK_DY) for (const dx of KICK_DX) { const q = { ...c, rot, x: c.x + dx, y: c.y + dy }; if (q.y >= 0 && fitsAt(g, q)) return q; }
      return null;
    }
    case 'soft_drop': return P.fits(g.board, cellsOf(c), c.x, c.y + 1) ? { ...c, y: c.y + 1 } : c; // at the bottom it just settles
    default: return c; // hard_drop, wait
  }
}

export const legalMoves = g => MOVES.filter(m => moved(g, m) !== null);

// Apply one action. Returns { ok, locked, cleared }.
export function act(g, move) {
  if (g.over) return { ok: false, locked: false, cleared: 0 };
  const q = moved(g, move);
  if (!q) return { ok: false, locked: false, cleared: 0 };
  g.trail.push(move);
  if (move === 'hard_drop') return { ok: true, locked: true, cleared: lockCurrent(g) };
  if (move === 'soft_drop' && q === g.cur) return { ok: true, locked: true, cleared: lockCurrent(g) };
  g.cur = q;
  return { ok: true, locked: false, cleared: 0 };
}

// One gravity tick: the piece falls a row, or locks when it cannot.
export function gravity(g) {
  if (g.over) return { locked: false, cleared: 0 };
  if (P.fits(g.board, cellsOf(g.cur), g.cur.x, g.cur.y + 1)) { g.cur = { ...g.cur, y: g.cur.y + 1 }; return { locked: false, cleared: 0 }; }
  return { locked: true, cleared: lockCurrent(g) };
}

// What happens if `move` is made and the piece then falls straight down.
export function preview(g, move) {
  const q = moved(g, move);
  if (!q) return null;
  const ly = dropY(g, q), before = P.features(g.board);
  const { board, cleared } = P.lock(g.board, cellsOf(q), q.x, ly, q.k), after = P.features(board);
  return { move, cols: [q.x, q.x + widthOf(q) - 1], cleared, newHoles: after.holes - before.holes, bump: after.bump, height: after.max,
    row: ly + heightOf(q) - 1, rot: q.rot, x: q.x };
}

// ---------- moving a piece to a chosen placement ----------
// The single action that takes the piece one step toward placement `t` ({ rot, x }): turn first, then slide, then drop.
// If the step is blocked it falls back to dropping, so a piece never gets stuck.
export function stepToward(g, t) {
  const c = g.cur, n = P.ROTATIONS[c.k].length;
  let want;
  if (c.rot !== t.rot) { const cw = (t.rot - c.rot + n) % n; want = n === 2 || cw <= n - cw ? 'rotate_cw' : 'rotate_ccw'; }
  else if (c.x < t.x) want = 'right';
  else if (c.x > t.x) want = 'left';
  else return 'hard_drop';
  return moved(g, want) ? want : 'hard_drop';
}

// Can the piece actually get to placement `t` by turning and sliding from where it is? (A tall stack can block the way.)
export function reachable(g, t) {
  const tmp = { board: g.board, cur: { ...g.cur } };
  for (let i = 0; i < 40; i++) {
    const a = stepToward(tmp, t);
    if (a === 'hard_drop') return tmp.cur.rot === t.rot && tmp.cur.x === t.x;
    tmp.cur = moved(tmp, a);
  }
  return false;
}

// ---------- oracle ----------
// One target placement (the best by the placement heuristic) and the action that starts toward it.
export function oracle(g) {
  const t = P.plan(g).ranked[0] || null;
  return { action: t ? stepToward(g, t) : 'hard_drop', target: t };
}

// ---------- spots: the strategy of the Laya playground's Tetris ----------
// Adapted from https://github.com/wdobry/laya-playground (MIT, static/demos/tetris.js; see THIRD_PARTY.md).
// Every place the piece could come to rest is put into one sentence (holes left under it, the bump it makes, lines completed) and the
// model is asked the same binary question about each: how would the stack look? The game picks the spot with the highest P(clean)
// and drives the piece there. The model never compares or counts: the game measured everything and hands over words.
const HOLES = ['no holes', 'one hole', 'two holes', 'three holes', 'many holes'], LINES = ['', 'one line', 'two lines', 'three lines', 'four lines'];
const BUMPS = ['no bump', 'a small bump', 'a big bump', 'a tall tower'];
const grade = (v, from, step) => Math.max(0, Math.min(3, Math.ceil((v - from) / step)));
export const SPOT_QUESTION = 'How does the stack look after the piece lands?';
export const SPOT_CRITERIA = { clean: 'flat with no holes', messy: 'holes or a tall tower' };

// A bump is the top of the stack getting rougher, or the piece ending up well above the average column, whichever is worse.
export function spotSentence(g, p, f0 = P.features(g.board)) {
  const holes = Math.max(0, p.holes - f0.holes), top = P.ROWS - p.y;
  const bump = Math.max(grade(p.bump - f0.bump, 0, 2), grade(top * P.COLS - f0.agg, 3 * P.COLS, P.COLS));
  return `The piece leaves ${HOLES[Math.min(4, holes)]} under it and makes ${BUMPS[bump]} on top.` + (p.cleared ? ` It completes ${LINES[Math.min(4, p.cleared)]}.` : '');
}

// One batched request: a question per landing spot (ids s0, s1, ...).
export function spotsRequest(g) {
  const all = P.placements(g), reach = all.filter(p => reachable(g, p)), spots = reach.length ? reach : all; // only spots the piece can get to
  const f0 = P.features(g.board), questions = {};
  spots.forEach((p, i) => { questions[`s${i}`] = { type: 'choice', instructions: `${spotSentence(g, p, f0)} ${SPOT_QUESTION}`, criteria: { ...SPOT_CRITERIA } }; });
  return { request: { state: 'Tetris: choosing where the falling piece should land.', questions }, spots };
}

// P(clean) for every spot, and the best one (the first wins a tie, so the choice is deterministic).
export function pickSpot(spots, answers) {
  const ps = spots.map((_, i) => answers[`s${i}`].probabilities.clean);
  let best = 0; ps.forEach((v, i) => { if (v > ps[best] + 1e-12) best = i; });
  const sorted = ps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  return { index: best, spot: spots[best], ps, median, spread: sorted[sorted.length - 1] - median };
}

// ---------- request ----------
export const REVERSE = { left: 'right', right: 'left', rotate_cw: 'rotate_ccw', rotate_ccw: 'rotate_cw' };
const LABEL = { left: 'Left', right: 'Right', rotate_cw: 'Turn clockwise', rotate_ccw: 'Turn back',
  soft_drop: 'Down one row', hard_drop: 'Drop now', wait: 'Wait' };
const PLAIN = { left: 'Move the piece one column to the left.', right: 'Move the piece one column to the right.',
  rotate_cw: 'Turn the piece 90 degrees clockwise.', rotate_ccw: 'Turn the piece 90 degrees counter-clockwise.',
  soft_drop: 'Move the piece down one row.', hard_drop: 'Drop the piece straight down now and lock it.',
  wait: 'Do nothing this turn; gravity keeps pulling the piece down.' };
const RULES = 'A full row clears and lowers the stack. An empty square under a block is a hole that can never be filled. The game ends when the stack reaches the top.';
const GOAL = 'Goal: clear rows, avoid holes, keep the surface flat and low.';
const surface = b => (b <= 3 ? 'very smooth' : b <= 7 ? 'smooth' : b <= 12 ? 'uneven' : 'jagged');
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const span = c => (c[0] === c[1] ? `col ${c[0]}` : `cols ${c[0]}-${c[1]}`);

// '#' settled, '@' the falling piece, '+' where it lands if left alone. One line per row, labelled.
export function boardLive(g) {
  const grid = g.board.map(r => r.map(v => (v ? '#' : '.')));
  if (!g.over) {
    const land = { ...g.cur, y: dropY(g) };
    for (const [x, y] of cellsAbs(land)) if (y >= 0) grid[y][x] = '+';
    for (const [x, y] of cellsAbs(g.cur)) if (y >= 0) grid[y][x] = '@';
  }
  return grid.map((r, i) => `row ${String(i).padStart(2, '0')} ${r.join('')}`);
}

function trailText(g) {
  if (!g.trail.length) return 'just appeared';
  const n = m => g.trail.filter(t => t === m).length;
  const dx = n('right') - n('left'), turns = n('rotate_cw') + n('rotate_ccw');
  return `moved ${dx === 0 ? 'nowhere sideways' : `${Math.abs(dx)} ${dx > 0 ? 'right' : 'left'}`}, turned ${turns}x, last action: ${g.trail[g.trail.length - 1]}`;
}

// ---------- "coach" variant: a port of the Agent-JEV-Tetris payload (https://github.com/Yasserbhb/Agent-JEV-Tetris) ----------
// Structured state, ranked priorities and per-option previews for a large model (about 2,700 tokens per request; too long
// for small encoders, whose instruction+option budget is 192 tokens). Field names follow that project's payload; the code is ours.
const NAME = { I: 'I (a straight bar of 4)', O: 'O (a 2x2 square)', J: 'J', L: 'L', S: 'S', T: 'T', Z: 'Z' };
const ACTION = {
  left: 'Move the piece one column to the left.', right: 'Move the piece one column to the right.',
  rotate_cw: 'Turn the piece 90 degrees clockwise.', rotate_ccw: 'Turn the piece 90 degrees counter-clockwise.',
  soft_drop: 'Move the piece down one row. Same columns, just closer to landing.',
  hard_drop: 'Drop the piece straight down now and lock it in place.',
  wait: 'Do nothing this turn. The piece stays exactly where it is and you will be asked again.',
};
export const COACH_KEY = { wait: 'none' };      // the coach payload calls "wait" none
export const COACH_MOVE = { none: 'wait' };

// Open notches in the surface: columns sitting below their neighbours, deepest first. A hole already covered is not here.
export function wells(g) {
  const h = P.features(g.board).heights, out = [];
  for (let c = 0; c < P.COLS; c++) {
    const depth = Math.min(c ? h[c - 1] : Infinity, c < P.COLS - 1 ? h[c + 1] : Infinity) - h[c];
    if (depth > 0) out.push({ column: c, depth, height: h[c] });
  }
  return out.sort((a, z) => z.depth - a.depth);
}

// Which piece kinds can drop into the dip at `col` without sealing anything (simulated, not guessed from width and depth).
export function fillers(g, col) {
  const before = P.features(g.board).holes;
  return P.PIECES.filter(k => P.ROTATIONS[k].some(cells => {
    const w = Math.max(...cells.map(v => v[0])) + 1;
    for (let x = 0; x <= P.COLS - w; x++) {
      if (!P.fits(g.board, cells, x, 0)) continue;
      let y = 0; while (P.fits(g.board, cells, x, y + 1)) y++;
      if (!cells.some(([cx]) => x + cx === col)) continue;
      if (P.features(P.lock(g.board, cells, x, y, k).board).holes <= before) return true;
    }
    return false;
  }));
}

// Rows that are partly filled and still completable, nearest-to-complete first. A gap with any block above it is sealed.
export function rowGaps(g) {
  const covered = (r, c) => g.board.slice(0, r).some(row => row[c]);
  return g.board.map((row, r) => ({ row: r, empty_columns: row.map((v, c) => (v ? -1 : c)).filter(c => c >= 0) }))
    .filter(o => o.empty_columns.length > 0 && o.empty_columns.length < P.COLS)
    .filter(o => !o.empty_columns.some(c => covered(o.row, c)))
    .sort((a, z) => a.empty_columns.length - z.empty_columns.length);
}

// The piece as it is now and after each turn, drawn with '@'.
export function turnShapes(c) {
  const n = P.ROTATIONS[c.k].length, art = rot => P.shapeArt(c.k, (rot + n) % n).replaceAll('#', '@').split('/');
  const out = { as_it_is_now: art(c.rot) };
  if (n > 1) { out.after_rotate_cw = art(c.rot + 1); if (n > 2) out.after_rotate_ccw = art(c.rot - 1); }
  return out;
}

const cols2 = (a, b) => (a === b ? String(a) : `${a}-${b}`);
function coachDone(g) {
  if (!g.trail.length) return 'nothing yet, it just appeared';
  const n = m => g.trail.filter(t => t === m).length, x = n('right') - n('left'), t = n('rotate_cw') - n('rotate_ccw');
  return [x === 0 ? 'not moved sideways' : `moved ${Math.abs(x)} column(s) ${x > 0 ? 'right' : 'left'}`,
    t === 0 ? 'not turned' : `turned ${Math.abs(t)} quarter-turn(s) ${t > 0 ? 'clockwise' : 'anticlockwise'}`,
    `last action: ${g.trail[g.trail.length - 1]}`].join('; ');
}

function coachRequest(g, gravityMs, thinkMs) {
  const f = P.features(g.board), c = g.cur, orc = oracle(g), t = orc.target;
  const movesPerRow = Math.max(1, Math.round(gravityMs / Math.max(thinkMs, 1))), fall = dropY(g) - c.y, actionsLeft = movesPerRow * fall;
  const heights = {}; f.heights.forEach((h, i) => { heights[`column_${i}`] = h; });
  const tStat = t && { cols: cols2(t.x, t.x + t.w - 1), row: t.y + Math.max(...t.cells.map(v => v[1])), clears: t.cleared, holes: t.holes - f.holes };
  const n = P.ROTATIONS[c.k].length, cw = t ? (t.rot - c.rot + n) % n : 0;
  const needed = t ? Math.abs(t.x - c.x) + Math.min(cw, n - cw) : 0;
  const criteria = {}, last = g.trail[g.trail.length - 1];
  for (const m of legalMoves(g)) {
    const key = COACH_KEY[m] || m;
    if (m === 'wait') { criteria[key] = { does: ACTION[m], note: 'Only when no other option improves the position.' }; continue; }
    const p = preview(g, m);
    criteria[key] = { does: ACTION[m], then_lands: { in_columns: cols2(p.cols[0], p.cols[1]), on_row: p.row, clears_lines: p.cleared, new_holes: p.newHoles, roughness_after: p.bump } };
    if (REVERSE[last] === m) criteria[key].warning = 'Reverses your last action. You end up back where you started, one row lower.';
    if (t && m === orc.action) criteria[key].this_starts_the_best_plan =
      `The best placement found for this piece is columns ${tStat.cols}, on_row ${tStat.row}, clears ${tStat.clears}, new_holes ${tStat.holes}. This action is the first step towards it.`;
  }
  const state = {
    rules: `Tetris. The board is ${P.COLS} columns wide (0 = far left) and ${P.ROWS} rows tall (row 0 = top, row ${P.ROWS - 1} = floor). One piece falls at a time; each turn you give it one action. ` +
      `GRAVITY: it also drops one row every ${gravityMs}ms whether you act or not, and you answer about every ${thinkMs}ms, so you get roughly ${movesPerRow} action(s) per row of fall. ` +
      `When it can fall no further it locks and the next piece starts at the top. A row with all ${P.COLS} squares filled CLEARS: it scores, it vanishes, and everything above drops down. ` +
      'Clearing is the only thing that lowers the stack. An empty square with a block above it is a HOLE: nothing can ever reach it, and its row cannot clear until every row above has gone. ' +
      'The game ENDS when the stack reaches the top.',
    goal: 'Keep the stack low and flat, and clear rows. Pack each piece snugly against what is already there with no gap sealed underneath. ' +
      'A tall jagged stack full of holes dies within a few pieces; a low flat one runs forever.',
    board: {
      legend: "'.' empty, '#' settled block, '@' the falling piece, '+' its landing shadow (exactly where it stops if you leave it alone). One line per row, labelled with its row number.",
      columns: '        ' + Array.from({ length: P.COLS }, (_, i) => i % 10).join(''),
      rows: boardLive(g).map(r => r.replace(/^row (\d\d) /, (_, d) => `row ${String(+d).padStart(2)}: `)),
    },
    falling_piece: {
      name: NAME[c.k], shapes: turnShapes(c), in_columns: [...new Set(cellsAbs(c).map(v => v[0]))],
      lands_on_row_if_untouched: preview(g, 'wait').row, rows_of_fall_left: fall, actions_left: actionsLeft, done_so_far: coachDone(g),
      best_placement_found: t ? `columns ${tStat.cols}, on_row ${tStat.row}, clears ${tStat.clears}, new_holes ${tStat.holes}. Reaching it takes ${needed} action(s) and you have about ${actionsLeft}. Start with: ${COACH_KEY[orc.action] || orc.action}.` : 'none',
    },
    next_piece: { name: NAME[g.next], shapes: turnShapes({ k: g.next, rot: 0 }) },
    stack: {
      column_heights: heights, tallest: f.max, holes: f.holes, roughness: f.bump,
      dips_you_can_fill: wells(g).slice(0, 4).map(w => {
        const fl = fillers(g, w.column);
        return `column ${w.column}: ${w.depth} row(s) below its neighbours, floor at height ${w.height}. ` +
          (fl.length ? `Fits cleanly: ${fl.join(', ')}${fl.length <= 2 ? ' ONLY - do not waste or bury it' : ''}.` : 'Nothing fits here cleanly any more.');
      }),
      rows_near_completing: rowGaps(g).slice(0, 4).map(r => `row ${r.row}: needs ${r.empty_columns.length}, at column(s) ${r.empty_columns.join(', ')}`),
    },
    progress: { score: g.score, rows_cleared: g.lines, pieces_placed: g.pieces },
  };
  const instructions = {
    task: 'Choose the single next action for the falling piece.',
    priorities_in_order: [
      '1. CLEAR A LINE. clears_lines above 0 means that placement completes rows and shortens the stack.',
      '2. LAND LOW. on_row is how deep the piece settles and BIGGER means LOWER. Take the biggest on_row you can reach. Never stack onto a tall column while a lower one is still reachable: that is how a mountain grows in the middle while the sides stay empty, and it is the fastest way to lose.',
      '3. MAKE NO HOLES. new_holes above 0 means you are sealing squares that can never be filled again and freezing every row they sit in. Prefer 0.',
      '4. STAY FLAT. Lower roughness_after means the next piece has somewhere to sit.',
      '5. LEAVE GAPS THAT SOME PIECE CAN ACTUALLY FILL. You cannot avoid leaving gaps, so leave deliberate ones. Each entry in stack.dips_you_can_fill names the pieces that still fit it. A dip only one or two pieces fit is precious: do not cover it, and spend the matching piece on it when it arrives. A dip nothing fits is dead weight you created. Check next_piece: if it fits an open dip, leave that dip alone this turn and put the current piece elsewhere.',
    ],
    where_to_aim: 'stack.dips_you_can_fill lists the surface dips a piece can still drop into, deepest first. stack.rows_near_completing lists the rows closest to clearing and exactly which columns they are missing. Both are already filtered to what is reachable. Steer the piece over those columns.',
    tie_breakers: [
      'Commit. falling_piece.done_so_far says how far you have already moved and turned it; carry on rather than reversing. An option marked warning undoes your last action.',
      'Once the landing shadow is where you want it, drop it. There is no reward for unused turns.',
      'When every option scores the same, as on a flat or empty board, head for an edge and pack from one side rather than dropping where the piece happened to appear.',
      'When every option looks BAD, do not thrash. There is always a least-bad one: fewest new_holes first, then biggest on_row. Pick it and see the piece through. Drifting between options while the piece sinks spends your turns and lands it wherever it happened to be, which is worse than any choice you could have made on purpose.',
    ],
    important: 'Every number in the options was measured from the board by the game, and says what happens if the piece falls straight down right after that action. Judge the options on those numbers. Do not try to count squares in the grid yourself.',
  };
  return { request: { state, questions: { move: { type: 'choice', instructions, criteria } } }, oracle: orc, previews: null, moveOf: COACH_MOVE };
}

function planText(g, orc) {
  const t = orc.target;
  if (!t) return '';
  const c = g.cur, n = P.ROTATIONS[c.k].length, cw = (t.rot - c.rot + n) % n;
  const steps = Math.abs(t.x - c.x) + Math.min(cw, n - cw);
  const lines = t.cleared ? `clears ${pl(t.cleared, 'line')}` : 'clears no lines';
  const holes = t.holes - P.features(g.board).holes;
  return `\nBest placement found for this piece: ${t.name} in ${span([t.x, t.x + t.w - 1])}, ${lines}, ${holes > 0 ? pl(holes, 'new hole') : 'no new holes'}. ` +
    `About ${pl(steps, 'action')} needed. Start with: ${orc.action}.`;
}

// hints: 'rich' = goal, board with shadow, both pieces, options with their outcomes in words
//        'best' = rich plus "Best." on the oracle's next action
//        'plan' = rich plus one statement in the state naming the best placement found and the first action toward it
//                 (the game does the search, the model executes: the main lesson of the Agent-JEV-Tetris write-up)
//        'coach' = a port of the Agent-JEV-Tetris payload (structured state, ranked priorities, gaps and near-complete rows); for large models
//        'none' = board and plain action descriptions only, no outcomes
export function toRequest(g, hints = 'rich', gravityMs = 700, thinkMs = 500) {
  if (hints === 'coach') return coachRequest(g, gravityMs, thinkMs);
  const f = P.features(g.board), c = g.cur, orc = oracle(g);
  const cols = '        ' + Array.from({ length: P.COLS }, (_, i) => i % 10).join('');
  const cw = c.x + widthOf(c) - 1;
  const state = `Tetris, ${P.COLS} columns (0 = left) by ${P.ROWS} rows (row 0 = top). One piece falls; each turn you give it one action, and gravity also drops it a row every ${gravityMs} ms. ` +
    `${RULES}${hints === 'none' ? '' : ` ${GOAL}`}\n` +
    `Board ('#' settled, '@' falling piece, '+' where it lands if left alone):\n${cols}\n${boardLive(g).join('\n')}\n` +
    `Falling: ${c.k} ${P.orientName(c.k, c.rot)}, in ${span([c.x, cw])}. Next piece: ${g.next}. This piece so far: ${trailText(g)}.\n` +
    `Stack height ${f.max} of ${P.ROWS}, ${pl(f.holes, 'hole')}, ${pl(g.lines, 'line')} cleared.` +
    (hints === 'plan' ? planText(g, orc) : '');
  const criteria = {}, previews = {};
  const last = g.trail[g.trail.length - 1];
  for (const m of legalMoves(g)) {
    const p = preview(g, m); previews[m] = p;
    if (hints === 'none') { criteria[m] = PLAIN[m]; continue; }
    const lines = p.cleared ? `clears ${pl(p.cleared, 'line')}` : 'no lines';
    const holes = p.newHoles > 0 ? pl(p.newHoles, 'new hole') : p.newHoles < 0 ? 'removes holes' : 'no holes';
    criteria[m] = `${hints === 'best' && m === orc.action ? 'Best. ' : ''}${LABEL[m]}: lands ${span(p.cols)}, ${lines}, ${holes}, ${surface(p.bump)}.` +
      (REVERSE[last] === m ? ' Undoes last move.' : '');
  }
  return { request: { state, questions: { move: { type: 'choice', instructions: 'Choose the next action for the falling piece.', criteria } } }, oracle: orc, previews };
}
