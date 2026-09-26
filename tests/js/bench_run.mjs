// Manual browser check against a running `decida serve` (not part of pytest: it needs a model and real time).
//   node tests/js/bench_run.mjs <bench> <model> "<query params>" [timeout-seconds]
//   e.g. node tests/js/bench_run.mjs dino pilot "seed=1&seconds=60&shield=0&hints=none"
//        node tests/js/bench_run.mjs snake qwen "seed=2&moves=300&delay=0&hints=nobest"
// Opens /bench/<bench>/ in headless Chromium with auto=1, waits for the report and prints it.
import { openPage } from './cdp.mjs';
const [bench, model, extra = '', timeout = '180'] = process.argv.slice(2);
const base = process.env.DECIDA_URL || 'http://localhost:8000';
const p = await openPage(`${base}/bench/${bench}/?auto=1&model=${model}&${extra}`);
const done = await p.waitFor(`document.querySelector('#report').classList.contains('on')`, +timeout * 1000);
console.log(done ? await p.evaluate(`document.querySelector('#report').innerText`) : 'TIMEOUT');
const msg = await p.evaluate(`document.querySelector('#msg').innerText`).catch(() => '');
if (msg) console.log('message:', msg);
if (p.logs.length) console.log('page errors:', p.logs);
p.close();
