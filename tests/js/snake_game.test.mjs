import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/decida/web/bench/snake/game.js';

// Play `budget` moves with a policy, restarting after a death (course seed + deaths). Returns totals.
function play(seed, policy, budget = 300) {
  let g = S.newGame(seed), deaths = 0, food = 0;
  for (let i = 0; i < budget; i++) {
    S.step(g, policy(g));
    if (g.dead) { deaths++; food += g.score; g = S.newGame(seed * 100 + deaths); }
  }
  return { deaths, food: food + g.score };
}
const oracle = g => S.plan(g).best;

test('same seed, same food sequence', () => {
  const foods = seed => { const g = S.newGame(seed); const xs = []; for (let i = 0; i < 60; i++) { S.step(g, oracle(g)); xs.push(g.food && `${g.food.x},${g.food.y}`); } return xs.join('|'); };
  assert.equal(foods(4), foods(4));
  assert.notEqual(foods(4), foods(5));
});

test('walls and body are fatal; the tail cell is free unless eating', () => {
  let g = S.newGame(1);
  g.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]; S.step(g, 'left');
  assert.ok(g.dead && g.cause === 'wall');
  g = S.newGame(1);
  g.snake = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }]; g.food = { x: 9, y: 9 };
  S.step(g, 'right'); // moves into the cell the tail just left: allowed
  assert.ok(!g.dead, 'chasing the tail is legal');
  g = S.newGame(1);
  g.snake = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 2 }]; g.food = { x: 3, y: 2 };
  S.step(g, 'right'); // food sits on the body: eating keeps the tail, so this is fatal
  assert.ok(g.dead && g.cause === 'body');
});

test('eating grows the snake and scores', () => {
  const g = S.newGame(1);
  g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };
  S.step(g, 'right');
  assert.equal(g.score, 1); assert.equal(g.snake.length, 4);
});

test('evaluate labels fatal, risky (pocket) and safe moves', () => {
  const g = S.newGame(1, 6);
  g.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]; g.food = { x: 5, y: 5 };
  assert.equal(S.evaluate(g, 'up').status, 'fatal');
  assert.equal(S.evaluate(g, 'right').status, 'fatal'); // into the neck
  assert.equal(S.evaluate(g, 'down').status, 'safe');
  // a dead-end pocket: head enters a 1-cell nook with a long body behind it
  const h = S.newGame(1, 5);
  h.snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
  h.food = { x: 4, y: 4 };
  const e = S.evaluate(h, 'right'); // (2,1): enclosed cell
  assert.equal(e.status, 'risky', JSON.stringify(e));
});

test('oracle beats random: eats at least 20 foods in 300 moves on 5 boards, few deaths', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = play(seed, oracle);
    assert.ok(r.food >= 20, `seed ${seed}: food ${r.food}`);
    assert.ok(r.deaths <= 1, `seed ${seed}: deaths ${r.deaths}`);
  }
  let x = 12345; const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const random = play(1, () => S.MOVES[Math.floor(rnd() * 4)]);
  assert.ok(random.deaths > 10, `random deaths ${random.deaths}`);
});

test('request: hints modes', () => {
  const g = S.newGame(2);
  for (let i = 0; i < 5; i++) S.step(g, oracle(g));
  const crit = h => Object.values(S.toRequest(g, h).request.questions.move.criteria).join(' ');
  assert.equal((crit('full').match(/Best\./g) || []).length, 1);
  assert.equal((crit('nobest').match(/Best\./g) || []).length, 0);
  assert.match(crit('nobest'), /Safe|Unsafe|Risky/);
  assert.doesNotMatch(crit('none'), /Safe|Unsafe|Risky|Best/);
  const r = S.toRequest(g, 'none').request;
  assert.match(r.state, /\n[.HoF]{10}/); // raw board present
  assert.deepEqual(Object.keys(r.questions.move.criteria), ['up', 'down', 'left', 'right']);
  assert.match(S.toRequest(g, 'full').request.state, /Head at \(\d+,\d+\)\. Food at/);
});
