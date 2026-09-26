// Prints a few hundred live-Tetris requests from varied game states as JSON (used by tests/test_bench_js.py to check token budgets).
import * as L from '../../src/decida/web/bench/tetris/live.js';
const out = [];
for (const seed of [1, 2, 3]) {
  const g = L.newLive(seed); let t = 0;
  while (!g.over && g.pieces < 25 && t < 4000) {
    for (const h of ['rich', 'best', 'plan']) out.push(L.toRequest(g, h, 700).request);
    // wander a bit like a confused model, then follow the oracle
    const m = t % 7 < 2 ? ['left', 'right', 'rotate_cw', 'rotate_ccw', 'soft_drop'][t % 5] : L.oracle(g).action;
    L.act(g, L.legalMoves(g).includes(m) ? m : 'wait'); t++; if (t % 3 === 0) L.gravity(g);
  }
}
console.log(JSON.stringify(out));
