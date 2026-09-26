// AI Town: the isometric renderer. Everything is drawn on one canvas with a hand-rolled projection: tiles on the ground, then buildings, trees and
// citizens sorted back to front. No images; every shape is a polygon or an arc. (Ideas: isometric projection and per-face shading, common to
// isometric city drawings; the shapes, palette and code are ours.)
import { N, QUARTERS } from './town.js';

const HW = 32, HH = 16;                       // half tile width and height in world pixels
const P = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];
export const ACTION_STYLE = { carry_on: { c: '#8a93a0', t: '…' }, investigate: { c: '#e39a2d', t: '?' }, join_in: { c: '#3f9d63', t: '★' }, warn_others: { c: '#d9453a', t: '!' } };
export const FEELING_COLOUR = ['#6fbf73', '#4aa3df', '#f0b03c', '#e5533d'];

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (h, f) => { const [r, g, b] = hex(h); const k = v => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${k(r)},${k(g)},${k(b)})`; };
const hash = (a, b, c = 0) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const COL = { grass: ['#9fce8b', '#95c682'], road: '#ead9ae', kerb: '#f4e9c8', soil: '#8b6b45', square: '#efe2be', pond: '#7fc4d8',
  wall: ['#f6ecd6', '#f9dcd0', '#dbeee2', '#e6dcf0'], roof: '#c2543b', slate: '#3f5f63', leaf: ['#4c9a46', '#5aa84f', '#3f8a3d'], trunk: '#7a5636' };

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.7; ctx.stroke(); }
}

// A box on the ground: top, the face towards +y (left on screen) and the face towards +x (right on screen), lit from the upper left.
function box(ctx, x0, y0, x1, y1, z0, z1, base, edge = 'rgba(60,40,20,.18)') {
  poly(ctx, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], shade(base, 0.9), edge);
  poly(ctx, [P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)], shade(base, 0.72), edge);
  poly(ctx, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(base, 1.06), edge);
}
// A gabled roof on a footprint; the ridge runs along y (axis 'y') or along x.
function gable(ctx, x0, y0, x1, y1, z, rise, col, axis = 'y', wall = '#f6ecd6') {
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, o = 0.06;
  if (axis === 'y') {
    poly(ctx, [P(x0, y1, z), P(x1, y1, z), P(xm, y1, z + rise)], shade(wall, 0.9), 'rgba(60,40,20,.18)');
    poly(ctx, [P(xm, y0 - o, z + rise), P(xm, y1 + o, z + rise), P(x1 + o, y1 + o, z - 1), P(x1 + o, y0 - o, z - 1)], shade(col, 0.82), 'rgba(60,20,10,.25)');
    poly(ctx, [P(x0 - o, y0 - o, z - 1), P(xm, y0 - o, z + rise), P(xm, y1 + o, z + rise), P(x0 - o, y1 + o, z - 1)], shade(col, 1.08), 'rgba(60,20,10,.25)');
  } else {
    poly(ctx, [P(x1, y0, z), P(x1, y1, z), P(x1, ym, z + rise)], shade(wall, 0.72), 'rgba(60,40,20,.18)');
    poly(ctx, [P(x0 - o, ym, z + rise), P(x1 + o, ym, z + rise), P(x1 + o, y1 + o, z - 1), P(x0 - o, y1 + o, z - 1)], shade(col, 0.9), 'rgba(60,20,10,.25)');
    poly(ctx, [P(x0 - o, y0 - o, z - 1), P(x1 + o, y0 - o, z - 1), P(x1 + o, ym, z + rise), P(x0 - o, ym, z + rise)], shade(col, 1.1), 'rgba(60,20,10,.25)');
  }
}
const winL = (ctx, x, y1, z, w, h, on = '#a9d6e8') => poly(ctx, [P(x, y1, z), P(x + w, y1, z), P(x + w, y1, z + h), P(x, y1, z + h)], on, 'rgba(60,40,20,.35)');   // window on the +y face
const winR = (ctx, x1, y, z, w, h, on = '#8fc0d6') => poly(ctx, [P(x1, y, z), P(x1, y + w, z), P(x1, y + w, z + h), P(x1, y, z + h)], on, 'rgba(60,40,20,.35)');   // on the +x face
const awning = (ctx, x0, x1, y1, z, depth, c1, c2, n = 6) => {   // a striped awning over the +y face
  for (let i = 0; i < n; i++) { const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n; poly(ctx, [P(a, y1, z), P(b, y1, z), P(b, y1 + depth, z - 5), P(a, y1 + depth, z - 5)], i % 2 ? c1 : c2, 'rgba(60,20,10,.2)'); }
};

// ---------- ground ----------
function drawGroundTile(ctx, x, y, t) {
  const c = t.kind;
  if (c === 'road') { poly(ctx, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], COL.road); return; }
  const g = hash(x, y) < 0.5 ? COL.grass[0] : COL.grass[1];
  poly(ctx, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], c === 'parkground' ? '#8cc678' : c === 'square' ? COL.square : g);
  if (c === 'grass' || c === 'tree') for (let k = 0; k < 2; k++) { const [px, py] = P(x + 0.2 + hash(x, y, k) * 0.6, y + 0.2 + hash(y, x, k + 4) * 0.6); ctx.fillStyle = 'rgba(70,120,60,.35)'; ctx.fillRect(px - 1, py - 1, 2, 1); }
}
// ---------- things that stand on the ground ----------
function drawTree(ctx, x, y, seed, pine) {
  const [sx, sy] = P(x + 0.5, y + 0.5), s = 0.85 + hash(x, y, seed) * 0.5;
  ctx.fillStyle = 'rgba(40,70,40,.22)'; ctx.beginPath(); ctx.ellipse(sx + 4, sy + 1, 9 * s, 4 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = COL.trunk; ctx.fillRect(sx - 1.4, sy - 9 * s, 2.8, 10 * s);
  if (pine) { for (let k = 0; k < 3; k++) { const w = (11 - k * 2.5) * s, y0 = sy - (6 + k * 7) * s; poly(ctx, [[sx - w, y0], [sx + w, y0], [sx, y0 - 13 * s]], shade(COL.leaf[k % 3], 0.85 + k * 0.08), 'rgba(20,60,20,.25)'); } return; }
  const g = ctx.createRadialGradient(sx - 4 * s, sy - 20 * s, 2, sx, sy - 16 * s, 15 * s); g.addColorStop(0, '#79c45f'); g.addColorStop(1, '#3f8a3d');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 16 * s, 12.5 * s, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(30,80,30,.18)'; ctx.beginPath(); ctx.arc(sx + 5 * s, sy - 12 * s, 7 * s, 0, 7); ctx.fill();
  if (hash(x, y, 9) < 0.3) { ctx.fillStyle = '#e8624a'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(sx - 6 * s + k * 6 * s, sy - (13 + (k % 2) * 6) * s, 1.6, 0, 7); ctx.fill(); } }
}
function drawGarden(ctx, x, y) {
  const cols = ['#f2a3b5', '#f7d76b', '#ffffff', '#c7a4ea'];
  for (let k = 0; k < 9; k++) { const [px, py] = P(x + 0.15 + hash(x, y, k) * 0.7, y + 0.15 + hash(y, x, k + 3) * 0.7); ctx.fillStyle = '#5aa84f'; ctx.fillRect(px - 1, py - 2, 2, 3); ctx.fillStyle = cols[k % 4]; ctx.beginPath(); ctx.arc(px, py - 3, 1.7, 0, 7); ctx.fill(); }
}
function drawLamp(ctx, x, y) { const [sx, sy] = P(x + 0.5, y + 0.5); ctx.fillStyle = '#5b5348'; ctx.fillRect(sx - 0.8, sy - 14, 1.6, 14); ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(sx, sy - 15, 2.4, 0, 7); ctx.fill(); }

function drawHome(ctx, b) {
  const v = b.variant || 0, x0 = b.x + 0.16, y0 = b.y + 0.16, x1 = b.x + 0.84, y1 = b.y + 0.84, wall = COL.wall[v % 4], axis = (b.x + b.y + v) % 2 ? 'x' : 'y';
  ctx.fillStyle = 'rgba(40,60,40,.2)'; poly(ctx, [P(x0 + 0.05, y1, 0), P(x1 + 0.28, y1, 0), P(x1 + 0.28, y0 + 0.28, 0), P(x1, y0, 0)], 'rgba(40,60,40,.2)');
  box(ctx, x0, y0, x1, y1, 0, 15, wall);
  winL(ctx, x0 + 0.1, y1, 6, 0.16, 6); winL(ctx, x1 - 0.28, y1, 6, 0.16, 6); winR(ctx, x1, y0 + 0.14, 6, 0.16, 6); winR(ctx, x1, y1 - 0.34, 6, 0.16, 6);
  poly(ctx, [P(x0 + 0.34, y1, 0), P(x0 + 0.5, y1, 0), P(x0 + 0.5, y1, 9), P(x0 + 0.34, y1, 9)], '#7a5a3c', 'rgba(40,20,10,.4)');
  gable(ctx, x0, y0, x1, y1, 15, 10, v === 2 ? COL.slate : COL.roof, axis, wall);
  if (v === 1) box(ctx, x0 + 0.5, y0 + 0.12, x0 + 0.66, y0 + 0.3, 20, 28, '#a86a4f');   // chimney
}
function drawBakery(ctx, b) {
  const x0 = b.x + 0.12, y0 = b.y + 0.12, x1 = b.x + 0.88, y1 = b.y + 0.88;
  box(ctx, x0, y0, x1, y1, 0, 17, '#f7e3ae'); gable(ctx, x0, y0, x1, y1, 17, 9, '#b8563a', 'x', '#f7e3ae');
  winL(ctx, x0 + 0.08, y1, 3, 0.22, 7, '#ffe9b0'); winL(ctx, x1 - 0.3, y1, 3, 0.22, 7, '#ffe9b0'); awning(ctx, x0 + 0.04, x1 - 0.04, y1, 11, 0.2, '#ffffff', '#d9463a', 7);
  winR(ctx, x1, y0 + 0.14, 5, 0.22, 7); box(ctx, x1 - 0.3, y0 + 0.08, x1 - 0.16, y0 + 0.22, 20, 32, '#9a6a52');
  const [sx, sy] = P(x1 - 0.5, y1 + 0.02, 22); ctx.fillStyle = '#d99a4a'; ctx.beginPath(); ctx.ellipse(sx + 4, sy - 2, 5, 3.2, 0, 0, 7); ctx.fill();   // a loaf on the sign
}
function drawClinic(ctx, b) {
  const x0 = b.x + 0.1, y0 = b.y + 0.1, x1 = b.x + 0.9, y1 = b.y + 0.9;
  box(ctx, x0, y0, x1, y1, 0, 20, '#e6f1f0'); box(ctx, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 20, 23, '#3f6f74');
  for (let k = 0; k < 3; k++) winL(ctx, x0 + 0.1 + k * 0.24, y1, 8, 0.16, 8, '#a9d6e8');
  winR(ctx, x1, y0 + 0.14, 8, 0.2, 8); winR(ctx, x1, y1 - 0.36, 8, 0.2, 8);
  const [cx, cy] = P((x0 + x1) / 2, (y0 + y1) / 2, 23); ctx.fillStyle = '#e04b4b'; ctx.fillRect(cx - 2.2, cy - 8, 4.4, 12); ctx.fillRect(cx - 6, cy - 4, 12, 4.4);
}
function drawFire(ctx, b) {
  const x0 = b.x + 0.08, y0 = b.y + 0.14, x1 = b.x + 0.92, y1 = b.y + 0.86;
  box(ctx, x0, y0, x1, y1, 0, 18, '#c9553f'); box(ctx, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 18, 21, '#8b3a2e');
  for (let k = 0; k < 2; k++) { const a = x0 + 0.1 + k * 0.38; poly(ctx, [P(a, y1, 0), P(a + 0.3, y1, 0), P(a + 0.3, y1, 12), P(a, y1, 12)], '#f2ede3', 'rgba(40,20,10,.4)'); poly(ctx, [P(a + 0.02, y1, 0), P(a + 0.28, y1, 0), P(a + 0.28, y1, 4), P(a + 0.02, y1, 4)], '#d64545'); }
  box(ctx, x1 - 0.32, y0 + 0.06, x1 - 0.06, y0 + 0.32, 21, 40, '#b84a36'); poly(ctx, [P(x1 - 0.36, y0 + 0.02, 40), P(x1 - 0.02, y0 + 0.02, 40), P(x1 - 0.02, y0 + 0.36, 40), P(x1 - 0.36, y0 + 0.36, 40), P((x1 - 0.19), y0 + 0.19, 52)], '#5a2f2a');
  winR(ctx, x1 - 0.06, y0 + 0.1, 26, 0.16, 8, '#ffe08a');
}
function drawLibrary(ctx, b) {
  const x0 = b.x + 0.08, y0 = b.y + 0.12, x1 = b.x + 0.92, y1 = b.y + 0.88;
  box(ctx, x0, y0, x1, y1, 0, 20, '#efe9dc'); box(ctx, x0 - 0.03, y0 - 0.03, x1 + 0.03, y1 + 0.03, 20, 23, '#c9bfa8');
  for (let k = 0; k < 4; k++) { const a = x0 + 0.06 + k * 0.2; box(ctx, a, y1 - 0.08, a + 0.09, y1, 0, 20, '#fbf8f0', 'rgba(60,40,20,.25)'); }
  poly(ctx, [P(x0 - 0.03, y1 + 0.03, 23), P(x1 + 0.03, y1 + 0.03, 23), P((x0 + x1) / 2, y1 + 0.03, 34)], '#d8cfba', 'rgba(60,40,20,.3)');
  winR(ctx, x1, y0 + 0.12, 7, 0.18, 9); winR(ctx, x1, y1 - 0.3, 7, 0.18, 9);
}
function drawCinema(ctx, b) {
  const x0 = b.x + 0.08, y0 = b.y + 0.1, x1 = b.x + 0.92, y1 = b.y + 0.9;
  box(ctx, x0, y0, x1, y1, 0, 21, '#8b6fb7'); box(ctx, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 21, 24, '#5c4685');
  poly(ctx, [P(x0 + 0.06, y1, 12), P(x1 - 0.06, y1, 12), P(x1 - 0.06, y1, 19), P(x0 + 0.06, y1, 19)], '#ffe27a', 'rgba(60,30,90,.6)');
  for (let k = 0; k < 6; k++) { const [px, py] = P(x0 + 0.1 + k * 0.12, y1, 15.5); ctx.fillStyle = '#c0392b'; ctx.fillRect(px - 1, py - 1, 2, 2); }
  poly(ctx, [P(x0 + 0.3, y1, 0), P(x0 + 0.62, y1, 0), P(x0 + 0.62, y1, 9), P(x0 + 0.3, y1, 9)], '#3a2a55');
  winR(ctx, x1, y0 + 0.16, 8, 0.2, 9, '#f6d6ff');
  const [sx, sy] = P(x0 + 0.5, y0 + 0.5, 24); ctx.fillStyle = '#ffe27a'; ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 3 : 7, a = -Math.PI / 2 + (k * Math.PI) / 5; ctx.lineTo(sx + Math.cos(a) * r, sy - 6 + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
}
function drawSchool(ctx, b) {
  const x0 = b.x + 0.08, y0 = b.y + 0.12, x1 = b.x + 0.92, y1 = b.y + 0.88;
  box(ctx, x0, y0, x1, y1, 0, 17, '#f0c25e'); gable(ctx, x0, y0, x1, y1, 17, 6, '#b8563a', 'x', '#f0c25e');
  for (let k = 0; k < 4; k++) winL(ctx, x0 + 0.08 + k * 0.19, y1, 6, 0.12, 7, '#a9d6e8');
  box(ctx, x0 + 0.34, y0 + 0.28, x0 + 0.62, y0 + 0.56, 20, 36, '#e8b04a'); poly(ctx, [P(x0 + 0.3, y0 + 0.24, 36), P(x0 + 0.66, y0 + 0.24, 36), P(x0 + 0.66, y0 + 0.6, 36), P(x0 + 0.3, y0 + 0.6, 36), P(x0 + 0.48, y0 + 0.42, 46)], '#b8563a');
  const [fx, fy] = P(x0 + 0.48, y0 + 0.42, 46); ctx.strokeStyle = '#5b5348'; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 9); ctx.stroke(); ctx.fillStyle = '#d9453a'; ctx.fillRect(fx, fy - 9, 6, 3.5);
}
function drawMarket(ctx, b) {
  const x0 = b.x + 0.08, y0 = b.y + 0.12, x1 = b.x + 0.92, y1 = b.y + 0.88, cols = ['#d9463a', '#3f9d63', '#e9a23b', '#4a90c9'];
  box(ctx, x0, y0, x1, y0 + 0.12, 0, 9, '#c9a878');
  for (let k = 0; k < 2; k++) { const a = x0 + k * 0.44; box(ctx, a, y1 - 0.34, a + 0.4, y1 - 0.06, 0, 6, '#b98c5a'); awning(ctx, a - 0.02, a + 0.42, y1 - 0.06, 14, 0.22, '#ffffff', cols[(b.x + k) % 4], 5); box(ctx, a, y1 - 0.34, a + 0.03, y1 - 0.31, 0, 14, '#8a6a44'); box(ctx, a + 0.37, y1 - 0.34, a + 0.4, y1 - 0.31, 0, 14, '#8a6a44'); }
  for (let k = 0; k < 5; k++) { const [px, py] = P(x0 + 0.08 + k * 0.16, y1 - 0.2, 7); ctx.fillStyle = ['#d9463a', '#f0a030', '#6fae5c'][k % 3]; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill(); }
}
function drawHall(ctx, b) {
  const x0 = b.x + 0.06, y0 = b.y + 0.1, x1 = b.x + 0.94, y1 = b.y + 0.9;
  box(ctx, x0, y0, x1, y1, 0, 22, '#f2ede0'); box(ctx, x0 - 0.03, y0 - 0.03, x1 + 0.03, y1 + 0.03, 22, 25, '#8a9a9a');
  for (let k = 0; k < 4; k++) winL(ctx, x0 + 0.1 + k * 0.2, y1, 8, 0.12, 9, '#a9d6e8');
  box(ctx, x0 + 0.3, y0 + 0.3, x0 + 0.66, y0 + 0.66, 25, 48, '#efe6d3'); poly(ctx, [P(x0 + 0.26, y0 + 0.26, 48), P(x0 + 0.7, y0 + 0.26, 48), P(x0 + 0.7, y0 + 0.7, 48), P(x0 + 0.26, y0 + 0.7, 48), P(x0 + 0.48, y0 + 0.48, 62)], '#3f6f74', 'rgba(20,50,50,.4)');
  const [cx, cy] = P(x0 + 0.66, y0 + 0.5, 38); ctx.fillStyle = '#fffdf6'; ctx.beginPath(); ctx.ellipse(cx, cy, 4, 5, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#3a3a3a'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy); ctx.lineTo(cx + 2, cy + 1); ctx.stroke();
}
function drawPark(ctx, b, time) {   // a gazebo and a pond on the tile, benches and trees come from the ground around it
  const x0 = b.x + 0.2, y0 = b.y + 0.2, x1 = b.x + 0.8, y1 = b.y + 0.8;
  const [px, py] = P(b.x + 0.5, b.y + 0.5); ctx.fillStyle = '#7fc4d8'; ctx.beginPath(); ctx.ellipse(px, py, 22, 10, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#d9e8d0'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(px - 4, py - 1, 8 + Math.sin(time * 1.4) * 1.5, 3, 0, 0, 7); ctx.stroke();
  for (const [a, c] of [[x0, y0], [x1 - 0.06, y0], [x0, y1 - 0.06], [x1 - 0.06, y1 - 0.06]]) box(ctx, a, c, a + 0.06, c + 0.06, 0, 13, '#c9a878', 'rgba(60,40,20,.25)');
  poly(ctx, [P(x0 - 0.05, y0 - 0.05, 13), P(x1 + 0.05, y0 - 0.05, 13), P(x1 + 0.05, y1 + 0.05, 13), P(x0 - 0.05, y1 + 0.05, 13), P((x0 + x1) / 2, (y0 + y1) / 2, 22)], '#b8563a', 'rgba(60,20,10,.3)');
}
function drawFountain(ctx, b, time) {
  const [cx, cy] = P(b.x + 1, b.y + 1);
  ctx.fillStyle = '#d8ccae'; ctx.beginPath(); ctx.ellipse(cx, cy, 34, 17, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#7fc4d8'; ctx.beginPath(); ctx.ellipse(cx, cy - 1, 29, 14, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.2; for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(cx, cy - 1, 12 + ((time * 8 + k * 9) % 17), 6 + ((time * 4 + k * 4.5) % 8), 0, 0, 7); ctx.globalAlpha = 1 - (((time * 8 + k * 9) % 17) / 17); ctx.stroke(); } ctx.globalAlpha = 1;
  ctx.fillStyle = '#e4d9bd'; ctx.fillRect(cx - 3, cy - 20, 6, 20); ctx.fillStyle = '#cfe9f2'; for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.28 + time; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 7, cy - 22 + Math.abs(Math.sin(a * 2)) * 4 + 6, 1.6, 0, 7); ctx.fill(); }
  ctx.beginPath(); ctx.arc(cx, cy - 24, 3.4, 0, 7); ctx.fill();
}
const DRAW = { home: drawHome, bakery: drawBakery, clinic: drawClinic, fire: drawFire, library: drawLibrary, cinema: drawCinema, school: drawSchool, market: drawMarket, hall: drawHall };

// ---------- citizens ----------
function drawCitizen(ctx, c, state, time) {
  const [sx, sy] = P(c.px + c.ox, c.py + c.oy), moving = c.activity === 'walking' || c.activity === 'reacting-walk', sw = moving ? Math.sin(c.walk) * 2.2 : 0, bob = moving ? Math.abs(Math.cos(c.walk)) * 1.1 : 0;
  const sel = state.selected === c, d = c.decision, s = 1.6, dim = state.filter && c.quarter !== state.filter;
  if (dim) ctx.globalAlpha = 0.25;
  ctx.fillStyle = 'rgba(30,50,30,.28)'; ctx.beginPath(); ctx.ellipse(sx, sy + 1, 5 * s, 2.4 * s, 0, 0, 7); ctx.fill();
  if (d && state.showDecisions) { ctx.strokeStyle = FEELING_COLOUR[d.feeling]; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy + 1, 7.5 * s, 3.6 * s, 0, 0, 7); ctx.stroke(); }
  if (sel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.ellipse(sx, sy + 1, 9 * s, 4.4 * s, 0, 0, 7); ctx.stroke(); ctx.strokeStyle = '#1f4d3a'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.strokeStyle = '#3d3a44'; ctx.lineWidth = 1.7 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx - 1.4 * s, sy - 5 * s - bob); ctx.lineTo(sx - 1.4 * s + sw * 0.5, sy); ctx.moveTo(sx + 1.4 * s, sy - 5 * s - bob); ctx.lineTo(sx + 1.4 * s - sw * 0.5, sy); ctx.stroke();
  ctx.fillStyle = c.look.shirt; ctx.beginPath(); ctx.roundRect(sx - 3.4 * s, sy - 12 * s - bob, 6.8 * s, 8 * s, 2.2 * s); ctx.fill();
  ctx.fillStyle = c.look.skin; ctx.beginPath(); ctx.arc(sx, sy - 15.2 * s - bob, 3.5 * s, 0, 7); ctx.fill();
  ctx.fillStyle = c.look.hair; ctx.beginPath(); ctx.arc(sx, sy - 16.2 * s - bob, 3.6 * s, Math.PI, 0); ctx.fill();
  if (state.showDecisions && c.bubble && d) {
    const st = ACTION_STYLE[c.bubble.action], age = Math.min(1, c.bubble.at / 0.25), by = sy - 27 * s - bob - (1 - age) * 6;
    ctx.globalAlpha = age; ctx.fillStyle = st.c; ctx.beginPath(); ctx.roundRect(sx - 6.5, by - 7, 13, 13, 4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - 2.5, by + 6); ctx.lineTo(sx, by + 10); ctx.lineTo(sx + 2.5, by + 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.t, sx, by - 0.5); ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
  if (sel || state.hovered === c) { ctx.font = '600 10.5px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; const w = ctx.measureText(c.name).width + 10; ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(sx - w / 2, sy - 44 * s + 18, w, 15, 7); ctx.fill(); ctx.fillStyle = '#1f3a2c'; ctx.fillText(c.name, sx, sy - 44 * s + 29); }
}

// ---------- the renderer ----------
export function createRenderer(canvas, town) {
  const ctx = canvas.getContext('2d'), cam = { x: 0, y: 13 * 2 * HH - 10, zoom: 1 };
  let W = 0, H = 0, dpr = 1;
  const specials = town.buildings.filter(b => b.kind !== 'home' && b.kind !== 'square');
  const quarterLabels = QUARTERS.map(q => { const bs = town.blocks.filter(b => b.quarter === q.id), cx = bs.reduce((a, b) => a + b.ox + 2, 0) / bs.length, cy = bs.reduce((a, b) => a + b.oy + 2, 0) / bs.length; return { name: q.name, x: cx, y: cy }; });
  const lamps = []; for (let i = 5; i < N; i += 5) for (let j = 5; j < N; j += 5) lamps.push([i, j]);

  const api = {
    cam,
    resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1); const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    },
    fit() { const bw = N * HW * 2 + 140, bh = N * HH * 2 + 260; cam.zoom = Math.min(W / bw, (H - 120) / bh); cam.x = 0; cam.y = N * HH + 30 - H * 0.05 / cam.zoom; },
    closeUp() { cam.zoom = Math.min(W, H) / 470; cam.x = 0; cam.y = N * HH - 20; },
    toWorld(sx, sy) { return [(sx - W / 2) / cam.zoom + cam.x, (sy - H / 2) / cam.zoom + cam.y]; },
    zoomAt(sx, sy, f) { const [wx, wy] = api.toWorld(sx, sy); cam.zoom = Math.max(0.35, Math.min(3.2, cam.zoom * f)); cam.x = wx - (sx - W / 2) / cam.zoom; cam.y = wy - (sy - H / 2) / cam.zoom; },
    pan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; },
    pick(sx, sy, citizens) {   // the citizen under the pointer, nearest first; else the building on that tile
      const [wx, wy] = api.toWorld(sx, sy); let best = null, bd = 16;
      for (const c of citizens) { const [px, py] = P(c.px + c.ox, c.py + c.oy); const d = Math.hypot(px - wx, py - 10 - wy); if (d < bd) { bd = d; best = c; } }
      if (best) return { citizen: best };
      const gy = wy + 12, tx = Math.floor((wx / HW + gy / HH) / 2), ty = Math.floor((gy / HH - wx / HW) / 2);
      return { building: town.buildings.find(b => b.kind !== 'square' ? b.x === tx && b.y === ty : tx >= b.x && tx < b.x + 2 && ty >= b.y && ty < b.y + 2) || null };
    },
    draw(state) {
      const time = state.time || 0, k = dpr * cam.zoom;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k, 0, 0, k, dpr * (W / 2 - cam.x * cam.zoom), dpr * (H / 2 - cam.y * cam.zoom));
      // the island: a soft shadow on the ground, the soil edge, then the tiles
      ctx.fillStyle = 'rgba(70,110,60,.30)'; ctx.beginPath(); ctx.ellipse(0, N * HH + 40, N * HW * 1.2, N * HH * 1.35, 0, 0, 7); ctx.fill();
      const A = P(0, 0), B = P(N, 0), C = P(N, N), D = P(0, N), T = 26;
      poly(ctx, [D, C, [C[0], C[1] + T], [D[0], D[1] + T]], '#7a5a3a'); poly(ctx, [C, B, [B[0], B[1] + T], [C[0], C[1] + T]], '#5f4529');
      for (let d = 0; d < 2 * N - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(d, N - 1); x++) { const y = d - x; drawGroundTile(ctx, x, y, town.tiles[x + y * N]); }
      // objects, back to front
      const items = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const t = town.tiles[x + y * N];
        if (t.kind === 'tree') items.push({ d: x + y + 0.5, f: () => drawTree(ctx, x, y, 1, hash(x, y, 7) < 0.4) });
        else if (t.kind === 'garden') items.push({ d: x + y + 0.2, f: () => drawGarden(ctx, x, y) });
        else if (t.kind === 'parkground' && hash(x, y, 2) < 0.6) items.push({ d: x + y + 0.5, f: () => drawTree(ctx, x, y, 3, hash(x, y, 5) < 0.3) });
      }
      for (const [i, j] of lamps) items.push({ d: i + j + 0.9, f: () => drawLamp(ctx, i - 1, j) });
      for (const b of town.buildings) {
        if (b.kind === 'square') items.push({ d: b.x + b.y + 2, f: () => drawFountain(ctx, b, time) });
        else if (b.kind === 'park') items.push({ d: b.x + b.y + 0.5, f: () => drawPark(ctx, b, time) });
        else items.push({ d: b.x + b.y + 1, f: () => DRAW[b.kind](ctx, b) });
      }
      for (const c of state.citizens) items.push({ d: c.px + c.py + c.ox + c.oy, f: () => drawCitizen(ctx, c, state, time) });
      items.sort((a, b) => a.d - b.d); for (const it of items) it.f();
      // labels: drawn in screen space so they keep one size however far the town is zoomed
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scr = (wx, wy) => [(wx - cam.x) * cam.zoom + W / 2, (wy - cam.y) * cam.zoom + H / 2];
      const pill = (text, wx, wy, alpha = 1, small = false) => {
        const [x, y] = scr(wx, wy); if (x < -80 || y < -30 || x > W + 80 || y > H + 30) return;
        ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${small ? 10.5 : 12}px system-ui,sans-serif`;
        const w = ctx.measureText(text).width + (small ? 12 : 18), h = small ? 17 : 21;
        ctx.fillStyle = 'rgba(255,251,240,.94)'; ctx.strokeStyle = 'rgba(60,80,50,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#26402f'; ctx.fillText(text, x, y + 0.5); ctx.globalAlpha = 1;
      };
      if (state.labels !== false) for (const q of quarterLabels) { const [lx, ly] = P(q.x, q.y); pill(q.name, lx, ly - 4, cam.zoom > 1.9 ? 0.4 : 1); }
      const near = new Set(state.labelled || []);
      for (const b of specials) { if (!(cam.zoom > 1.3 || b === state.hoverBuilding || near.has(b.id))) continue; const [lx, ly] = P(b.x + 0.5, b.y + 0.5, 34); pill(b.name, lx, ly - 6, 1, true); }
    },
  };
  return api;
}
