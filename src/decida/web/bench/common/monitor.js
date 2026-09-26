// The monitor panel shared by every bench: stat tiles, the model's answer (probability bars with an "oracle" tag), a moves-chosen
// tally, a response-time chart, and the exact state / options / raw response of the last request.
// Layout adapted from Agent (JEV) playing Tetris: https://github.com/Yasserbhb/Agent-JEV-Tetris (see THIRD_PARTY.md).
const $ = s => document.querySelector(s);
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
export const stat = (label, v, bad) => `<div class="stat${bad ? ' bad' : ''}"><small>${label}</small><b>${v}</b></div>`;

export function panelHTML(opts = {}) { // four groups, so a wide layout can lay them out as columns; { answer: false } leaves out the generic answer bars
  return `<div class="mon-g"><h2>Monitor</h2>
  <div class="stats" id="stats"></div>
  <div class="cut" id="cut"></div>
  <div id="counts" class="sub"></div></div>
  ${opts.answer === false ? '' : `<div class="mon-g"><h2>Model's answer</h2>
  <div id="answer" class="sub">not asked yet</div>
  <div class="bars" id="bars" style="margin-top:6px"></div></div>`}
  <div class="mon-g"><h2 id="lat-h">Response time</h2>
  <canvas id="lat" width="560" height="110" aria-label="Response time over time"></canvas>
  <div id="meter" class="sub"></div>
  <div id="rate-g" style="display:none"><h2 id="rate-h">Per second</h2>
  <canvas id="rate" width="560" height="70" aria-label="Rate chart"></canvas></div></div>
  <div class="mon-g"><h2>State sent</h2>
  <pre class="box" id="sent"></pre>
  <h2>Options sent</h2>
  <pre class="box" id="opts"></pre>
  <h2>Raw response</h2>
  <pre class="box" id="got"></pre></div>`;
}

// Latency against elapsed time: one dot per request, a "now" edge that keeps moving when no requests arrive, seconds on the axis.
let times = []; // when each latency sample arrived (performance.now()), kept in step with m.lat
function drawLatency(lat, tokens, now) {
  const canvas = $('#lat'), ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, padT = 8, padB = 18, right = 40;
  ctx.clearRect(0, 0, W, H);
  if (!lat.length) { $('#meter').textContent = ''; return; }
  const origin = times[0] - 400, span = Math.max(15000, Math.min(300000, now - origin)), from = now - span < origin ? origin : now - span, to = from + span;
  const top = Math.max(...lat, 10) * 1.15, px = t => ((t - from) / span) * (W - right), py = v => H - padB - (v / top) * (H - padB - padT);
  ctx.font = '10px ui-monospace,monospace'; ctx.lineWidth = 1;
  for (const f of [0, .5, 1]) { const v = Math.round(top * f), y = py(v); ctx.strokeStyle = css('--line'); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - right, y); ctx.stroke(); ctx.fillStyle = css('--ink3'); ctx.textAlign = 'left'; ctx.fillText(v + 'ms', W - right + 4, y + 3); }
  ctx.textAlign = 'center'; ctx.fillStyle = css('--ink3'); // time axis, in seconds since the first request
  for (let k = 0; k <= 4; k++) { const t = from + (span * k) / 4; ctx.fillText(`${Math.round((t - origin) / 1000)}s`, Math.min(W - right - 8, Math.max(10, px(t))), H - 4); }
  const p50 = pct(lat, .5), p95 = pct(lat, .95);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = css('--green'); ctx.beginPath(); ctx.moveTo(0, py(p50)); ctx.lineTo(W - right, py(p50)); ctx.stroke();
  ctx.strokeStyle = css('--red'); ctx.beginPath(); ctx.moveTo(0, py(p95)); ctx.lineTo(W - right, py(p95)); ctx.stroke(); ctx.setLineDash([]);
  const pts = lat.map((v, i) => [px(times[i]), py(v)]).filter(([x]) => x >= -2);
  ctx.strokeStyle = css('--acc'); ctx.lineWidth = 1.6; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  if (pts.length) { const [lx, ly] = pts[pts.length - 1]; ctx.globalAlpha = .45; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(W - right, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; } // no request since then: time is passing
  ctx.fillStyle = css('--acc'); for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); }
  ctx.strokeStyle = css('--ink3'); ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(W - right, padT); ctx.lineTo(W - right, H - padB); ctx.stroke(); ctx.globalAlpha = 1; // "now"
  const r = v => Math.round(v);
  $('#meter').innerHTML = `last <b>${r(lat[lat.length - 1])} ms</b> · p50 <b>${r(p50)} ms</b> · p95 <b>${r(p95)} ms</b> · min <b>${r(Math.min(...lat))}</b> · max <b>${r(Math.max(...lat))}</b> · <b>${tokens.toLocaleString()}</b> tokens over <b>${lat.length}</b> requests · <b>${Math.round((now - origin) / 1000)} s</b>`;
}

function drawRate(values, label) { // bars: a count per second, newest on the right
  const canvas = $('#rate'), ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, padB = 16, padT = 6, right = 40, vs = Array.from(values, v => v || 0).slice(-120);
  ctx.clearRect(0, 0, W, H);
  if (!vs.length) return;
  const top = Math.max(...vs, 1) * 1.1, bw = (W - right) / Math.max(vs.length, 30);
  ctx.font = '10px ui-monospace,monospace'; ctx.fillStyle = css('--ink3'); ctx.textAlign = 'left'; ctx.fillText(Math.round(top) + '', W - right + 4, padT + 8); ctx.fillText('0', W - right + 4, H - padB);
  ctx.strokeStyle = css('--line'); ctx.beginPath(); ctx.moveTo(0, H - padB + .5); ctx.lineTo(W - right, H - padB + .5); ctx.stroke();
  ctx.fillStyle = css('--acc'); ctx.globalAlpha = .85;
  vs.forEach((v, i) => { const h = (v / top) * (H - padB - padT); ctx.fillRect(i * bw + 1, H - padB - h, Math.max(1, bw - 2), h); });
  ctx.globalAlpha = 1; ctx.fillStyle = css('--ink3'); ctx.textAlign = 'center'; ctx.fillText(`${vs.length}s`, Math.min(W - right - 8, vs.length * bw), H - 3);
}

// m = { lat: [ms], tokens, counts: {choice: n}, countsLabel?, done, cut: {turns, options, state} | null,
//       last: { probs, choice, confidence, ms, oracle, request, raw } | null,
//       now?: a frozen clock (set when a run has finished), latLabel?: heading, rate?: [count per second], rateLabel?: heading }
// Cheap to call every frame: the DOM is only rewritten when the data changed.
let seen = { last: null, latN: -1, counts: '', drawnAt: 0, rateN: -1 };
export function update(m) {
  const cut = $('#cut');
  if (m.cut && m.cut.turns) { cut.className = 'cut on'; cut.textContent = `Token budget cut text on ${m.cut.turns} requests (up to ${m.cut.options} options${m.cut.state ? ', and the state' : ''}). The model did not see everything.`; } else cut.className = 'cut';
  const counts = m.done ? (m.countsLabel || 'moves chosen') + ': ' + Object.entries(m.counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(100 * v / m.done)}%`).join(', ') : '';
  if (counts !== seen.counts) { $('#counts').textContent = counts; seen.counts = counts; }
  const now = m.now || performance.now();
  if (m.lat.length < times.length) times = [];
  while (times.length < m.lat.length) times.push(now); // stamp new samples as they appear
  if (m.latLabel) $('#lat-h').textContent = m.latLabel;
  if (m.lat.length !== seen.latN || m.now !== seen.frozen || (!m.now && now - seen.drawnAt > 250)) { drawLatency(m.lat, m.tokens || 0, now); seen.latN = m.lat.length; seen.drawnAt = now; seen.frozen = m.now; }
  if (m.rate) { // an optional second chart: a count per second
    $('#rate-g').style.display = 'block'; $('#rate-h').textContent = m.rateLabel || 'Per second';
    if (m.rate.length !== seen.rateN || m.now !== seen.frozenRate || !m.now) { drawRate(m.rate, m.rateLabel); seen.rateN = m.rate.length; seen.frozenRate = m.now; }
  }
  const l = m.last;
  if (!l || l === seen.last) return;
  seen.last = l;
  const probs = l.probs, keys = Object.keys(probs).sort((a, b) => probs[b] - probs[a]).slice(0, 8);
  if ($('#answer')) $('#answer').innerHTML = `${l.subject ? esc(l.subject) + ' · ' : ''}<b>${esc(l.choice)}</b> · confidence ${l.confidence.toFixed(2)} · <b>${Math.round(l.ms)} ms</b>${l.msLabel ? ' ' + esc(l.msLabel) : ''}${l.oracle ? ` · oracle would play <b>${esc(l.oracle)}</b>` : ''}`;
  if ($('#bars')) $('#bars').innerHTML = keys.map(k => { const t = k === l.choice ? ' top' : ''; return `<span class="${t}">${esc(k)}${k === l.oracle ? '<span class="tag">oracle</span>' : ''}</span><span class="track ${t}"><span class="fill${t}" style="width:${(probs[k] * 100).toFixed(1)}%"></span></span><span class="num">${(probs[k] * 100).toFixed(1)}%</span>`; }).join('');
  const q = l.request.questions[Object.keys(l.request.questions)[0]];
  $('#sent').textContent = typeof l.request.state === 'string' ? l.request.state : JSON.stringify(l.request.state, null, 2);
  $('#opts').textContent = JSON.stringify(q, null, 1);
  $('#got').textContent = JSON.stringify(l.raw, null, 2);
}
export const resetMonitor = () => { seen = { last: null, latN: -1, counts: '', drawnAt: 0, rateN: -1 }; times = []; };
