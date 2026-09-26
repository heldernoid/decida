// Minimal Chrome DevTools driver (no dependencies): launch headless Chromium, open a URL, evaluate JS.
// Used by browser tests that need a real page talking to a real `decida serve`.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell')).sort().reverse()) {
    const base = join(root, d);
    for (const sub of readdirSync(base)) {
      const p = join(base, sub, 'chrome-headless-shell');
      try { if (statSync(p).isFile()) return p; } catch {}
    }
  }
  throw new Error('no chrome-headless-shell found; set CHROME=');
}

export async function openPage(url) {
  const profile = mkdtempSync(join(tmpdir(), 'decida-chrome-')); // a fresh profile per run: no stale cached modules
  // port 0 = let Chrome choose; it writes the port into DevToolsActivePort in OUR profile, so we can never attach to a stale browser
  const proc = spawn(findChrome(), ['--no-sandbox', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  process.once('exit', () => { try { proc.kill(); } catch {} });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = +readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
    if (!port) await new Promise(r => setTimeout(r, 100));
  }
  if (!port) { proc.kill(); throw new Error('Chrome did not start'); }
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map(); const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const waitFor = async (expr, ms, every = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch {} await new Promise(r => setTimeout(r, every)); }
    return false;
  };
  const screenshot = async (path, width = 1200, height = 800) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  };
  return { evaluate, waitFor, screenshot, logs, close: () => { ws.close(); proc.kill(); } };
}
