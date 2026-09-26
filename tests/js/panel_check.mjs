// Manual browser check (needs a running `decida serve` with a model): every bench must fill the shared monitor panel.
//   DECIDA_URL=http://localhost:8000 node tests/js/panel_check.mjs <model> [screenshot-dir]
import { openPage } from './cdp.mjs';
const model = process.argv[2] || 'pilot', shots = process.argv[3], base = process.env.DECIDA_URL || 'http://localhost:8000';
const benches = [['dino', 'seconds=30&hints=full', 'window.__dino'], ['snake', 'moves=200&delay=40', 'window.__snake'], ['tetris', 'pieces=30&delay=60&gravity=400', 'window.__live'], ['sorter', 'balls=2000&batch=16&hints=name&animate=0', 'window.__sorter']];
// Each page's answer elements: the generic panel by default, Snake has its own bars.
const ANSWER = { snake: { text: '#rdState', bars: '#snBars .abar', tag: '#snBars .abar.oracle' } }, DEFAULT = { text: '#answer', bars: '#bars .track', tag: '#bars .tag' };
let bad = 0;
for (const [name, q, g] of benches) {
  const p = await openPage(`${base}/bench/${name}/?auto=1&model=${model}&${q}`);
  await p.waitFor(`${g} && ${g}.S && ${g}.S.lat && ${g}.S.lat.length >= 6`, 40000, 150);
  const r = JSON.parse(await p.evaluate(`JSON.stringify({
    meter: document.querySelector('#meter').innerText, sent: document.querySelector('#sent').textContent.length,
    opts: document.querySelector('#opts').textContent.length, got: document.querySelector('#got').textContent.length,
    counts: document.querySelector('#counts').innerText, bars: document.querySelectorAll(${JSON.stringify((ANSWER[name] || DEFAULT).bars)}).length,
    oracleTag: !!document.querySelector(${JSON.stringify((ANSWER[name] || DEFAULT).tag)}), answer: document.querySelector(${JSON.stringify((ANSWER[name] || DEFAULT).text)}).innerText })`));
  const ok = /p50/.test(r.meter) && r.sent > 20 && r.opts > 20 && r.got > 20 && /(moves|bowls) chosen/.test(r.counts) && r.bars >= 2 && r.oracleTag && !p.logs.length;
  if (!ok) bad++;
  console.log(name.padEnd(7), ok ? 'OK ' : 'BAD', JSON.stringify({ ...r, meter: r.meter.slice(0, 60), answer: r.answer.slice(0, 50) }), p.logs.length ? p.logs : '');
  if (shots) await p.screenshot(`${shots}/panel_${name}.png`, 1180, name === 'tetris' ? 1000 : 900);
  p.close();
}
process.exit(bad ? 1 : 0);
