import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../src/decida/web/bench/tetris/game.js';

test('7-bag: every bag of seven has all seven pieces; same seed same sequence', () => {
  const seq = seed => { const g = P.newGame(seed); const out = [g.piece, g.next]; for (let i = 0; i < 26; i++) out.push(P.draw(g)); return out; };
  const a = seq(3);
  for (let i = 0; i + 7 <= 28; i += 7) assert.equal(new Set(a.slice(i, i + 7)).size, 7, `bag ${i / 7}: ${a.slice(i, i + 7)}`);
  assert.deepEqual(seq(3), seq(3));
  assert.notDeepEqual(seq(3), seq(4));
});

test('rotation counts: I,S,Z 2; O 1; T,J,L 4; all cells normalised', () => {
  const n = p => P.ROTATIONS[p].length;
  assert.deepEqual([n('I'), n('S'), n('Z'), n('O'), n('T'), n('J'), n('L')], [2, 2, 2, 1, 4, 4, 4]);
  for (const p of P.PIECES) for (const c of P.ROTATIONS[p]) { assert.equal(c.length, 4); assert.equal(Math.min(...c.map(v => v[0])), 0); assert.equal(Math.min(...c.map(v => v[1])), 0); }
});

test('orientation names match the drawings and ids are unique and readable', () => {
  assert.equal(P.shapeArt('T', 0), '###/.#.'); assert.equal(P.orientName('T', 0), 'pointing down');
  assert.equal(P.shapeArt('T', 2), '.#./###'); assert.equal(P.orientName('T', 2), 'pointing up');
  assert.equal(P.shapeArt('I', 0), '####'); assert.equal(P.orientName('I', 1), 'upright');
  assert.equal(P.shapeArt('J', 0), '#../###'); assert.equal(P.orientName('J', 0), 'flat, hook up-left');
  assert.equal(P.shapeArt('L', 3), '##/.#/.#'); assert.equal(P.orientName('L', 3), 'upright, hook top-left');
  for (const p of P.PIECES) assert.equal(P.ROTATIONS[p].length, new Set(P.ROTATIONS[p].map((_, r) => P.orientName(p, r))).size);
  const g = P.newGame(1);
  for (const p of P.PIECES) { const ids = P.placements(g, p).map(x => x.id); assert.equal(new Set(ids).size, ids.length); }
  assert.match(P.placements(g, 'T')[0].id, /^pointing-down@0$/);
});

test('empty board: I piece has 7 flat + 10 upright placements, O has 9', () => {
  const g = P.newGame(1);
  assert.equal(P.placements(g, 'I').length, 7 + 10);
  assert.equal(P.placements(g, 'O').length, 9);
});

test('a flat I on an empty board lands on the floor and features are right', () => {
  const g = P.newGame(1);
  const p = P.placements(g, 'I').find(x => x.id === 'flat@0');
  assert.equal(p.y, P.ROWS - 1); assert.equal(p.holes, 0); assert.equal(p.max, 1); assert.equal(p.cleared, 0);
  assert.equal(p.bump, 1); // heights 1,1,1,1,0,0,0,0,0,0 -> one step of 1
});

test('locking clears full rows and removes them', () => {
  const g = P.newGame(1);
  for (let y = P.ROWS - 4; y < P.ROWS; y++) for (let x = 1; x < P.COLS; x++) g.board[y][x] = 1; // column 0 empty, four rows deep
  const cells = P.ROTATIONS.I[1];
  const { board, cleared } = P.lock(g.board, cells, 0, P.ROWS - 4);
  assert.equal(cleared, 4);
  assert.ok(board.every(r => r.every(c => !c)), 'board is empty after a tetris');
});

test('holes are counted; an overhang creates one', () => {
  const g = P.newGame(1);
  g.board[P.ROWS - 1][0] = 1; // one filled cell at the floor of column 0
  g.board[P.ROWS - 3][0] = 1; // filled cell two above with an empty cell between
  assert.equal(P.features(g.board).holes, 1);
});

test('no placements when there is no room to spawn', () => {
  const h = P.newGame(1); for (let y = 0; y < 2; y++) for (let x = 0; x < P.COLS; x++) h.board[y][x] = 1;
  assert.equal(P.placements(h).length, 0);
});

test('the heuristic ranks a line-clearing, hole-free placement first', () => {
  const g = P.newGame(1);
  g.piece = 'I';
  for (let y = P.ROWS - 4; y < P.ROWS; y++) for (let x = 1; x < P.COLS; x++) g.board[y][x] = 1;
  const pl = P.plan(g);
  assert.equal(pl.best, 'upright@0'); assert.equal(pl.ranked[0].cleared, 4);
});
