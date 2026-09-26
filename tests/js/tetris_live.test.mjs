import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../src/decida/web/bench/tetris/game.js';
import * as L from '../../src/decida/web/bench/tetris/live.js';

// Play `pieces` with the oracle: `actionsPerRow` actions between gravity ticks, like the page does.
function playOracle(seed, pieces, actionsPerRow = 4) {
  const g = L.newLive(seed); let turns = 0;
  while (!g.over && g.pieces < pieces && turns < pieces * 200) {
    L.act(g, L.oracle(g).action); turns++;
    if (turns % actionsPerRow === 0) L.gravity(g);
  }
  return { g, turns };
}

test('a new piece spawns near the top centre and is legal', () => {
  const g = L.newLive(1);
  assert.equal(g.cur.y, 0);
  const w = Math.max(...L.cellsOf(g.cur).map(c => c[0])) + 1;
  assert.equal(g.cur.x, Math.floor((P.COLS - w) / 2));
  assert.ok(!g.over && g.cur.k === g.piece);
});

test('left/right stop at the walls and at blocks; illegal moves are not offered', () => {
  const g = L.newLive(1);
  while (L.act(g, 'left').ok);
  assert.equal(g.cur.x, 0);
  assert.ok(!L.legalMoves(g).includes('left'));
  assert.ok(L.legalMoves(g).includes('right') && L.legalMoves(g).includes('hard_drop') && L.legalMoves(g).includes('wait'));
  const h = L.newLive(1); h.board[0][h.cur.x + 5] = 'X'; h.board[1][h.cur.x + 5] = 'X'; // a block right beside the piece
  while (L.act(h, 'right').ok);
  assert.ok(h.cur.x + Math.max(...L.cellsOf(h.cur).map(c => c[0])) < h.cur.x + 5 + 1);
});

test('rotation: O cannot turn, I/S/Z have one turn direction, T/J/L both; kicks off a wall', () => {
  const g = L.newLive(1);
  const moves = k => { g.piece = k; g.cur = { k, rot: 0, x: 3, y: 5 }; return L.legalMoves(g).filter(m => m.startsWith('rotate')); };
  assert.deepEqual(moves('O'), []);
  for (const k of ['I', 'S', 'Z']) assert.deepEqual(moves(k), ['rotate_cw'], k);
  for (const k of ['T', 'J', 'L']) assert.deepEqual(moves(k), ['rotate_cw', 'rotate_ccw'], k);
  g.cur = { k: 'I', rot: 0, x: 6, y: 5 }; // flat bar against the right wall: upright fits in place
  L.act(g, 'rotate_cw'); assert.equal(g.cur.rot, 1);
  g.cur = { k: 'I', rot: 1, x: 9, y: 5 }; L.act(g, 'rotate_cw'); // flat bar at column 9 would leave the board: kick left
  assert.equal(g.cur.rot, 0); assert.ok(g.cur.x + 3 < P.COLS);
});

test('gravity drops a row per tick and locks at the bottom; hard drop locks at once', () => {
  const g = L.newLive(1);
  const y0 = g.cur.y; L.gravity(g); assert.equal(g.cur.y, y0 + 1);
  const n = g.pieces; let locked = false;
  for (let i = 0; i < 30 && !locked; i++) locked = L.gravity(g).locked;
  assert.ok(locked && g.pieces === n + 1);
  const h = L.newLive(2); const r = L.act(h, 'hard_drop'); assert.ok(r.locked && h.pieces === 1);
});

test('soft drop on the floor locks the piece', () => {
  const g = L.newLive(1);
  g.cur = { ...g.cur, y: L.dropY(g) };
  assert.ok(L.act(g, 'soft_drop').locked);
});

test('line clear scores and the board keeps piece kinds for colouring', () => {
  const g = L.newLive(1);
  for (let x = 1; x < P.COLS; x++) g.board[P.ROWS - 1][x] = 'T';
  g.piece = 'I'; g.cur = { k: 'I', rot: 1, x: 0, y: 0 };
  const r = L.act(g, 'hard_drop');
  assert.equal(r.cleared, 1); assert.equal(g.lines, 1); assert.equal(g.score, 40);
  assert.ok(g.board.flat().some(v => v === 'I'), 'the rest of the I bar stays and remembers its kind');
});

test('preview equals actually doing the move and then a hard drop', () => {
  const g = L.newLive(3);
  for (let i = 0; i < 5; i++) { const o = L.oracle(g).action; L.act(g, o); if (g.trail.length === 0) break; }
  for (const m of L.legalMoves(g)) {
    const p = L.preview(g, m);
    const c = structuredClone({ ...g, rand: null }); c.rand = g.rand; // move on a copy; the rng is not consumed before the lock
    const before = P.features(c.board);
    L.act(c, m); if (m !== 'hard_drop' && m !== 'soft_drop' || c.pieces === g.pieces) { c.cur = { ...c.cur, y: L.dropY(c) }; L.act(c, 'hard_drop'); }
    const after = P.features(c.board);
    assert.equal(after.holes - before.holes, p.newHoles, `${m} holes`);
    assert.equal(c.lines - g.lines, p.cleared, `${m} lines`);
  }
});

test('the oracle steers every piece to its target placement and plays 150 pieces without topping out', () => {
  for (const seed of [1, 2, 3]) {
    const { g } = playOracle(seed, 150, 4);
    assert.ok(!g.over, `seed ${seed} topped out after ${g.pieces} pieces`);
    assert.ok(g.lines >= 40, `seed ${seed}: only ${g.lines} lines`);
  }
});

test('the oracle still copes when gravity is fast (2 actions per row) and never ping-pongs', () => {
  const { g, turns } = playOracle(2, 80, 2);
  assert.ok(!g.over, `topped out after ${g.pieces} pieces`);
  assert.ok(turns / g.pieces < 40, `too many actions per piece: ${turns / g.pieces}`);
});

test('request: legal moves only, board with @ and +, both pieces, compact option text, hints modes', () => {
  const g = L.newLive(2);
  L.act(g, 'right');
  const { request, oracle } = L.toRequest(g, 'best', 700);
  const q = request.questions.move, keys = Object.keys(q.criteria);
  assert.deepEqual(keys.sort(), L.legalMoves(g).sort());
  assert.match(request.state, /row 00 /); assert.match(request.state, /@/); assert.match(request.state, /\+/);
  assert.match(request.state, /Next piece: [IOTSZJL]/); assert.match(request.state, /moved 1 right/);
  assert.match(request.state, /gravity also drops it a row every 700 ms/);
  assert.equal(Object.values(q.criteria).filter(t => t.startsWith('Best.')).length, 1);
  assert.ok(q.criteria[oracle.action].startsWith('Best.'));
  for (const t of Object.values(q.criteria)) assert.ok(t.length <= 95, `option too long for small models: ${t.length} ${t}`);
  assert.ok(q.criteria.left.endsWith('Undoes last move.'), 'left after right is flagged');
  const rich = L.toRequest(g, 'rich').request.questions.move.criteria;
  assert.ok(Object.values(rich).every(t => !t.startsWith('Best.')));
  const none = L.toRequest(g, 'none').request;
  assert.ok(Object.values(none.questions.move.criteria).every(t => !/lands in|clears|holes/.test(t)));
  assert.doesNotMatch(none.state, /Goal:/);
});

test('same seed, same game', () => {
  const run = seed => { const { g } = playOracle(seed, 20, 4); return JSON.stringify([g.board, g.lines, g.score, g.next]); };
  assert.equal(run(5), run(5)); assert.notEqual(run(5), run(6));
});

test('plan variant: the state names the best placement and the first action; options stay unmarked', () => {
  const g = L.newLive(2);
  const { request, oracle } = L.toRequest(g, 'plan', 700);
  assert.match(request.state, /Best placement found for this piece: .+ in cols? \d/);
  assert.ok(request.state.includes(`Start with: ${oracle.action}.`));
  assert.match(request.state, /About \d+ actions? needed/);
  assert.ok(Object.values(request.questions.move.criteria).every(t => !t.startsWith('Best.')));
  assert.ok(!L.toRequest(g, 'rich').request.state.includes('Best placement found'));
  // following the plan reaches the target: play 3 pieces by always doing what the plan says
  const h = L.newLive(4); let turns = 0;
  while (h.pieces < 3 && turns < 200) { const m = L.toRequest(h, 'plan').oracle.action; L.act(h, m); if (++turns % 4 === 0) L.gravity(h); }
  assert.equal(h.pieces, 3);
});

test('coach variant: structured payload with the same sections as the Agent-JEV-Tetris payload', () => {
  const g = L.newLive(2);
  L.act(g, 'right'); L.gravity(g);
  const { request, oracle, moveOf } = L.toRequest(g, 'coach', 1500, 700);
  const st = request.state, q = request.questions.move;
  for (const k of ['rules', 'goal', 'board', 'falling_piece', 'next_piece', 'stack', 'progress']) assert.ok(k in st, k);
  assert.match(st.rules, /every 1500ms.*about every 700ms.*roughly 2 action/);
  assert.equal(st.board.rows.length, P.ROWS); assert.match(st.board.rows[0], /^row  0: [.#@+]{10}$/);
  assert.match(st.board.columns, /^ {8}0123456789$/);
  for (const k of ['name', 'shapes', 'in_columns', 'lands_on_row_if_untouched', 'rows_of_fall_left', 'actions_left', 'done_so_far', 'best_placement_found']) assert.ok(k in st.falling_piece, k);
  assert.match(st.falling_piece.best_placement_found, /^columns .+, on_row \d+, clears \d, new_holes -?\d+\. Reaching it takes \d+ action\(s\) and you have about \d+\. Start with: \w+\./);
  assert.equal(Object.keys(st.stack.column_heights).length, P.COLS);
  assert.deepEqual(Object.keys(q.instructions), ['task', 'priorities_in_order', 'where_to_aim', 'tie_breakers', 'important']);
  const opts = Object.entries(q.criteria);
  assert.ok(opts.length >= 4);
  for (const [k, v] of opts) { assert.ok(v.does, k); if (k !== 'none') assert.deepEqual(Object.keys(v.then_lands), ['in_columns', 'on_row', 'clears_lines', 'new_holes', 'roughness_after']); }
  assert.deepEqual(Object.keys(q.criteria).sort(), L.legalMoves(g).map(m => L.COACH_KEY[m] || m).sort());
  const starts = opts.filter(([, v]) => v.this_starts_the_best_plan);
  assert.equal(starts.length, 1); assert.equal(moveOf[starts[0][0]] || starts[0][0], oracle.action);
  assert.ok(q.criteria.left && q.criteria.left.warning, 'left after right carries the undo warning');
});

test('coach helpers: wells, fillers (simulated), rowGaps ignores sealed gaps, turn shapes', () => {
  const g = L.newLive(1);
  const R = P.ROWS;
  for (let x = 0; x < P.COLS; x++) if (x !== 4) { g.board[R - 1][x] = 'X'; g.board[R - 2][x] = 'X'; }  // a 1-wide, 2-deep well at column 4
  assert.deepEqual(L.wells(g)[0], { column: 4, depth: 2, height: 0 });
  assert.ok(L.fillers(g, 4).includes('I'), 'an upright I fits a 1-wide well');
  assert.ok(!L.fillers(g, 4).includes('O'), 'a 2x2 square does not');
  const gaps = L.rowGaps(g);
  assert.equal(gaps[0].empty_columns.length, 1); assert.deepEqual(gaps[0].empty_columns, [4]);
  g.board[R - 3][4] = 'Y'; // seal the well from above
  assert.ok(L.rowGaps(g).every(r => r.row !== R - 1 && r.row !== R - 2), 'sealed rows are not advertised');
  assert.deepEqual(Object.keys(L.turnShapes({ k: 'T', rot: 0, x: 0, y: 0 })), ['as_it_is_now', 'after_rotate_cw', 'after_rotate_ccw']);
  assert.deepEqual(Object.keys(L.turnShapes({ k: 'O', rot: 0, x: 0, y: 0 })), ['as_it_is_now']);
  assert.deepEqual(Object.keys(L.turnShapes({ k: 'I', rot: 0, x: 0, y: 0 })), ['as_it_is_now', 'after_rotate_cw']);
  assert.deepEqual(L.turnShapes({ k: 'T', rot: 0, x: 0, y: 0 }).as_it_is_now, ['@@@', '.@.']);
});

test('every variant states the rules; only the non-raw variants state the goal', () => {
  const g = L.newLive(2);
  for (const h of ['rich', 'best', 'plan', 'none']) {
    const st = L.toRequest(g, h, 700).request.state;
    assert.match(st, /A full row clears/, h); assert.match(st, /hole that can never be filled/, h); assert.match(st, /game ends when the stack reaches the top/, h);
    assert.equal(/Goal:/.test(st), h !== 'none', h);
  }
  assert.ok('rules' in L.toRequest(g, 'coach', 700).request.state);
});

test('pickSeed: a number replays that game, anything else picks a fresh seed', async () => {
  const { pickSeed } = await import('../../src/decida/web/bench/common/rng.js');
  assert.equal(pickSeed('42'), 42); assert.equal(pickSeed(' 7 '), 7);
  const seeds = new Set(Array.from({ length: 30 }, () => pickSeed('random')));
  assert.ok(seeds.size > 25, 'random seeds vary');
  for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 1 && s <= 999999);
  for (const bad of ['', 'abc', '0', '-3']) assert.ok(pickSeed(bad) >= 1);
  // the same seed really is the same game, and two random games differ
  const a = L.newLive(pickSeed('123')), b = L.newLive(pickSeed('123'));
  assert.deepEqual([a.piece, a.next], [b.piece, b.next]);
  const firsts = new Set(Array.from({ length: 20 }, () => { const g = L.newLive(pickSeed('random')); return g.piece + g.next; }));
  assert.ok(firsts.size > 5, 'random games start with different pieces');
});

// ---------- spots strategy ----------
test('spot sentences turn measurements into the words the model reads', () => {
  const g = L.newLive(1); g.piece = 'I'; g.cur = { k: 'I', rot: 0, x: 3, y: 0 };
  const spots = P.placements(g), s = spots.map(p => L.spotSentence(g, p));
  assert.ok(s.every(x => /^The piece leaves (no holes|one hole|two holes|three holes|many holes) under it and makes (no bump|a small bump|a big bump|a tall tower) on top\.( It completes (one|two|three|four) lines?\.)?$/.test(x)), s[0]);
  assert.ok(s.some(x => x.includes('no holes') && x.includes('a small bump') || x.includes('no bump')), 'flat I placements read as clean');
  assert.ok(s.some(x => x.includes('a tall tower')), 'standing the I bar upright makes a tower');
  const h = L.newLive(1); // a cliff with a covered gap: dropping beside it buries holes
  for (let x = 0; x < 6; x++) for (let y = P.ROWS - 4; y < P.ROWS; y++) h.board[y][x] = 'X';
  h.board[P.ROWS - 1][6] = 0; h.board[P.ROWS - 2][6] = 'X'; // a covered hole
  h.piece = 'I'; h.cur = { k: 'I', rot: 0, x: 3, y: 0 };
  const hs = P.placements(h).map(p => L.spotSentence(h, p));
  assert.ok(hs.some(x => /one hole|two holes|three holes|many holes/.test(x)));
  const g2 = L.newLive(1); for (let x = 1; x < P.COLS; x++) g2.board[P.ROWS - 1][x] = 'T'; g2.piece = 'I'; g2.cur = { k: 'I', rot: 1, x: 0, y: 0 };
  assert.ok(P.placements(g2).map(p => L.spotSentence(g2, p)).some(x => x.includes('It completes one line.')));
});

test('spots request: one binary question per landing spot in a single batch', () => {
  const g = L.newLive(2), { request, spots } = L.spotsRequest(g);
  assert.equal(Object.keys(request.questions).length, spots.length); assert.ok(spots.length >= 9 && spots.length <= 34);
  const q = request.questions.s0; assert.equal(q.type, 'choice'); assert.deepEqual(q.criteria, L.SPOT_CRITERIA);
  assert.ok(q.instructions.endsWith(L.SPOT_QUESTION)); assert.doesNotMatch(q.instructions, /\d/, 'words, never numbers');
  assert.match(request.state, /choosing where the falling piece should land/);
  assert.ok(Object.values(request.questions).every(x => x.instructions.length < 200));
});

test('pickSpot: highest P(clean) wins, ties go to the first spot, and the signal is reported', () => {
  const spots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const ans = ps => Object.fromEntries(ps.map((p, i) => [`s${i}`, { probabilities: { clean: p, messy: 1 - p } }]));
  const r = L.pickSpot(spots, ans([0.1, 0.9, 0.2, 0.3]));
  assert.equal(r.spot.id, 'b'); assert.equal(r.index, 1); assert.ok(Math.abs(r.spread - 0.6) < 1e-9, `spread ${r.spread}`); assert.ok(Math.abs(r.median - 0.3) < 1e-9);
  assert.equal(L.pickSpot(spots, ans([0.1, 0.9, 0.9, 0.3])).index, 1, 'a tie keeps the first');
  assert.equal(L.pickSpot(spots, ans([0.5, 0.5, 0.5, 0.5])).index, 0); assert.equal(L.pickSpot(spots, ans([0.5, 0.5, 0.5, 0.5])).spread, 0);
});

test('autopilot: stepToward brings every kind of piece to any chosen spot, and it lands exactly as predicted', () => {
  for (const seed of [1, 2, 3]) {
    const g = L.newLive(seed);
    for (let n = 0; n < 40 && !g.over; n++) {
      const spots = L.spotsRequest(g).spots; if (!spots.length) break;
      const target = spots[(n * 7) % spots.length];              // any reachable spot, not just good ones
      const id = g.pieceId; let steps = 0;
      while (g.pieceId === id && steps++ < 60) L.act(g, L.stepToward(g, target));
      assert.ok(g.pieceId !== id, `piece never landed (seed ${seed}, piece ${n}, ${steps} steps)`);
      assert.deepEqual(g.board.map(r => r.map(v => (v ? 1 : 0))), target.board.map(r => r.map(v => (v ? 1 : 0))), `landed somewhere else than ${target.id}`);
    }
  }
});

test('spots strategy end to end with a stand-in model that answers from the oracle plays 100 pieces without topping out', () => {
  const g = L.newLive(5);
  for (let n = 0; n < 100 && !g.over; n++) {
    const { spots } = L.spotsRequest(g), best = P.plan(g).ranked[0].id;
    const answers = Object.fromEntries(spots.map((p, i) => [`s${i}`, { probabilities: { clean: p.id === best ? 0.9 : 0.2, messy: 0.1 } }]));
    const { spot } = L.pickSpot(spots, answers), id = g.pieceId; let steps = 0;
    while (g.pieceId === id && steps++ < 60) L.act(g, L.stepToward(g, spot));
  }
  assert.ok(!g.over && g.pieces >= 100, `pieces ${g.pieces}`); assert.ok(g.lines >= 30, `lines ${g.lines}`);
});

test('reachable: a wall of blocks at the top of the well cuts off the spots beyond it', () => {
  const g = L.newLive(1); g.piece = 'O'; g.cur = { k: 'O', rot: 0, x: 4, y: 0 };
  const all = P.placements(g);
  assert.ok(all.every(p => L.reachable(g, p)), 'on an open board every spot is reachable');
  for (let y = 0; y < 4; y++) g.board[y][7] = 'X';                     // a tall column on the right, reaching the spawn rows
  const reach = all.filter(p => L.reachable(g, p)), cut = all.filter(p => !L.reachable(g, p));
  assert.ok(cut.length > 0 && cut.every(p => p.x >= 6), `cut off: ${cut.map(p => p.id)}`);
  assert.ok(reach.every(p => p.x <= 5) && reach.length > 0);
  assert.deepEqual(L.spotsRequest(g).spots.map(p => p.id), reach.map(p => p.id), 'the request only asks about reachable spots');
});
