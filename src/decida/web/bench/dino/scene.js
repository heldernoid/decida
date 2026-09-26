// Drawing for the T-Rex runner: night sky, parallax hills, a shaded dino, cacti and a bird, all as vector shapes.
// Pure drawing: takes a 2D context in game units (W x H) and a game state, keeps no state of its own, so the same frame
// always looks the same. Hitboxes live in game.js; every shape here is drawn to fit inside its box.
import { W, H, DINO_X, DINO_W, DINO_H, DUCK_W, DUCK_H } from './game.js';

export const GROUND_Y = 140;
const TAU = Math.PI * 2;
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
const disc = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
const wrap = (v, m) => ((v % m) + m) % m;
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function sky(c, g) {
  const grad = c.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, '#0b1020'); grad.addColorStop(.6, '#1a2440'); grad.addColorStop(1, '#3b3560');
  c.fillStyle = grad; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 34; i++) { // stars twinkle and drift very slowly
    const x = wrap(hash(i) * W - g.dist * 0.01, W), y = hash(i + 50) * 78, tw = .45 + .55 * Math.sin(g.frame / 40 + i * 1.7);
    c.fillStyle = `rgba(255,255,255,${.25 + .5 * tw * hash(i + 90)})`; c.fillRect(x, y, 1.2, 1.2);
  }
  const mx = W - 92, my = 34; // moon with a soft halo
  const halo = c.createRadialGradient(mx, my, 4, mx, my, 34); halo.addColorStop(0, 'rgba(255,240,200,.35)'); halo.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = halo; c.fillRect(mx - 40, my - 40, 80, 80);
  c.fillStyle = '#f5ecd0'; disc(c, mx, my, 11); c.fillStyle = 'rgba(190,175,140,.5)'; disc(c, mx - 3, my - 2, 2.6); disc(c, mx + 4, my + 3, 1.8);
}

function hills(c, g, k, base, amp, color, seed) { // one parallax layer: k = scroll speed relative to the ground
  c.fillStyle = color; c.beginPath(); c.moveTo(0, GROUND_Y);
  for (let x = 0; x <= W; x += 6) { const u = (x + g.dist * k) / 90; c.lineTo(x, base - amp * (.55 + .45 * Math.sin(u + seed)) * (.6 + .4 * Math.sin(u * .37 + seed * 2))); }
  c.lineTo(W, GROUND_Y); c.closePath(); c.fill();
}

function clouds(c, g) {
  c.fillStyle = 'rgba(190,200,235,.13)';
  for (let i = 0; i < 4; i++) {
    const x = wrap(i * 190 + 60 - g.dist * 0.08 - g.frame * .05, W + 120) - 60, y = 22 + hash(i + 7) * 40, s = .8 + hash(i + 3) * .6;
    c.beginPath(); c.ellipse(x, y, 26 * s, 6 * s, 0, 0, TAU); c.ellipse(x - 12 * s, y - 4 * s, 13 * s, 7 * s, 0, 0, TAU); c.ellipse(x + 10 * s, y - 5 * s, 14 * s, 8 * s, 0, 0, TAU); c.fill();
  }
}

function ground(c, g) {
  const grad = c.createLinearGradient(0, GROUND_Y, 0, H); grad.addColorStop(0, '#4a4368'); grad.addColorStop(1, '#221e38');
  c.fillStyle = grad; c.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(0, GROUND_Y, W, 1);
  for (let i = 0; i < 26; i++) { // pebbles and dashes scroll with the ground
    const x = wrap(i * 61 - g.dist, W + 40) - 20, y = GROUND_Y + 3 + hash(i) * 6, w = 2 + hash(i + 5) * 5;
    c.fillStyle = i % 3 ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.28)'; rr(c, x, y, w, 1.2, .6); c.fill();
  }
  c.strokeStyle = 'rgba(120,214,160,.55)'; c.lineWidth = 1; c.lineCap = 'round'; // grass tufts
  for (let i = 0; i < 9; i++) { const x = wrap(i * 83 + 20 - g.dist, W + 30) - 15; c.beginPath(); c.moveTo(x, GROUND_Y); c.lineTo(x - 1.6, GROUND_Y - 4); c.moveTo(x, GROUND_Y); c.lineTo(x + .4, GROUND_Y - 5); c.moveTo(x, GROUND_Y); c.lineTo(x + 2, GROUND_Y - 3.5); c.stroke(); }
}

function dust(c, g) { // little puffs kicked up behind the feet while it runs; none in the air
  if (g.y > 0) return;
  const foot = DINO_X + 6, every = 5, age0 = g.frame % every;
  for (let k = 0; k < 5; k++) {
    const age = age0 + k * every, born = g.frame - age, life = age / (every * 5), x = foot - age * (g.speed * .5), y = GROUND_Y - 1.5 - life * 7, r = 1.2 + life * 2.6;
    if (hash(born) < .35) continue;
    c.fillStyle = `rgba(200,190,225,${.32 * (1 - life)})`; disc(c, x, y, r);
  }
}

function shadow(c, x, w, lift) { // the shadow shrinks and fades as the dino leaves the ground
  const f = Math.max(.35, 1 - lift / 90); c.fillStyle = `rgba(0,0,0,${.35 * f})`; c.beginPath(); c.ellipse(x, GROUND_Y + 2, w * f / 2, 2.4 * f, 0, 0, TAU); c.fill();
}

const PAL = { body: ['#7be8b0', '#2fb37c', '#1c7a58'], belly: '#d6f7e4', spike: '#1c7a58', dead: ['#e8a3a3', '#b56060', '#7a3a3a'] };

function dinoGradient(c, y0, y1, dead) {
  const p = dead ? PAL.dead : PAL.body, gr = c.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, p[0]); gr.addColorStop(.55, p[1]); gr.addColorStop(1, p[2]); return gr;
}

function eye(c, x, y, r, dead) {
  c.fillStyle = '#fff'; disc(c, x, y, r);
  if (dead) { c.strokeStyle = '#2a1414'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - r * .55, y - r * .55); c.lineTo(x + r * .55, y + r * .55); c.moveTo(x + r * .55, y - r * .55); c.lineTo(x - r * .55, y + r * .55); c.stroke(); }
  else { c.fillStyle = '#111'; disc(c, x + r * .25, y + r * .05, r * .55); c.fillStyle = '#fff'; disc(c, x + r * .4, y - r * .2, r * .2); }
}

function dinoStand(c, g, ox, oy, dead) { // fits the DINO_W x DINO_H box
  const step = (g.frame >> 3) & 1, air = g.y > 0, body = dinoGradient(c, oy, oy + DINO_H, dead), dark = dead ? '#7a3a3a' : PAL.spike;
  c.save(); c.translate(ox, oy);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.fillStyle = body; c.strokeStyle = body; // legs (behind the body): alternate strides, tucked when airborne
  const leg = (x, lift, fwd) => { c.lineWidth = 5; c.beginPath(); c.moveTo(x, 33); c.lineTo(x + fwd, 40 - lift); c.lineTo(x + fwd + 2.5, 45 - lift * .4); c.stroke(); c.lineWidth = 2.8; c.beginPath(); c.moveTo(x + fwd + 1, 46.2 - lift * .4); c.lineTo(x + fwd + 6, 46.2 - lift * .4); c.stroke(); };
  if (air) { leg(13, 2, -2); leg(24, 1, 3); } else if (step) { leg(13, 0, 1); leg(24, 5, -2); } else { leg(13, 5, -2); leg(24, 0, 1); }
  c.beginPath(); c.moveTo(7, 27); c.bezierCurveTo(4, 24, 1, 20, -1, 15); c.bezierCurveTo(4, 18, 9, 19, 14, 19); c.closePath(); c.fill(); // tail
  c.beginPath(); c.moveTo(-1, 15); c.quadraticCurveTo(-4, 13, -3, 11); c.quadraticCurveTo(2, 12, 6, 17); c.fill();
  c.beginPath(); c.ellipse(19, 27, 15, 11, -.12, 0, TAU); c.fill(); // body
  c.beginPath(); c.moveTo(24, 22); c.quadraticCurveTo(28, 13, 30, 7); c.lineTo(38, 9); c.quadraticCurveTo(35, 18, 33, 27); c.closePath(); c.fill(); // neck
  rr(c, 26, 0, 18, 13, 5.5); c.fill(); // head
  rr(c, 34, 6, 10, 7, 3.5); c.fill();
  c.fillStyle = PAL.belly; c.globalAlpha = dead ? .55 : .9; c.beginPath(); c.ellipse(21, 31, 11, 5.5, .05, 0, Math.PI); c.fill(); c.globalAlpha = 1; // belly
  c.fillStyle = dark; for (let i = 0; i < 4; i++) { const x = 8 + i * 5.5, y = 17 - i * .8; c.beginPath(); c.moveTo(x - 2, y + 1); c.lineTo(x + .5, y - 3.4); c.lineTo(x + 2.4, y + 1); c.fill(); } // back spikes
  c.fillStyle = body; rr(c, 29, 25, 8, 3, 1.5); c.fill(); c.fillStyle = dark; c.fillRect(35.5, 25.6, 1.4, 1.4); c.fillRect(33, 25.6, 1.4, 1.4); // little arm
  eye(c, 35, 4.6, 2.5, dead);
  c.strokeStyle = '#124a36'; c.lineWidth = .9; c.beginPath(); c.moveTo(43, 10.4); c.lineTo(dead ? 37 : 38.5, dead ? 11.6 : 10.2); c.stroke(); // mouth
  c.fillStyle = '#124a36'; c.fillRect(41.4, 6.8, 1.1, 1.1);
  if (dead) { c.strokeStyle = '#e23b3b'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(40, 11); c.quadraticCurveTo(43, 14, 46, 13); c.stroke(); }
  c.restore();
}

function dinoDuck(c, g, ox, oy, dead) { // fits the DUCK_W x DUCK_H box
  const step = (g.frame >> 3) & 1, body = dinoGradient(c, oy, oy + DUCK_H, dead), dark = dead ? '#7a3a3a' : PAL.spike;
  c.save(); c.translate(ox, oy); c.lineCap = 'round'; c.lineJoin = 'round';
  c.fillStyle = body; c.strokeStyle = body;
  const leg = (x, up) => { c.lineWidth = 4.6; c.beginPath(); c.moveTo(x, 17); c.lineTo(x + (up ? -2 : 1), 22.4); c.stroke(); c.lineWidth = 2.6; c.beginPath(); c.moveTo(x + (up ? -2 : 1), 24); c.lineTo(x + (up ? 2 : 5), 24); c.stroke(); };
  leg(19, step); leg(30, !step);
  c.beginPath(); c.moveTo(4, 12); c.quadraticCurveTo(-2, 10, -1, 5); c.quadraticCurveTo(6, 6, 12, 10); c.fill(); // tail, held out behind
  c.beginPath(); c.ellipse(26, 13, 23, 8.2, -.04, 0, TAU); c.fill(); // long low body
  rr(c, 40, 1, 19, 12.5, 5.5); c.fill(); // head, thrust forward
  rr(c, 48, 6, 11, 7.5, 3.5); c.fill();
  c.fillStyle = PAL.belly; c.globalAlpha = dead ? .55 : .9; c.beginPath(); c.ellipse(27, 17.4, 15, 3.6, 0, 0, Math.PI); c.fill(); c.globalAlpha = 1;
  c.fillStyle = dark; for (let i = 0; i < 5; i++) { const x = 9 + i * 6; c.beginPath(); c.moveTo(x - 2, 7.4); c.lineTo(x + .6, 3.2); c.lineTo(x + 2.6, 7.6); c.fill(); }
  eye(c, 50, 5.2, 2.4, dead);
  c.strokeStyle = '#124a36'; c.lineWidth = .9; c.beginPath(); c.moveTo(57.6, 10.6); c.lineTo(dead ? 51 : 52.6, dead ? 11.8 : 10.4); c.stroke();
  c.restore();
}

function cactus(c, o) { // o.x, o.h, o.n, o.size. Stroked, round-capped limbs shaded with a gradient
  const small = o.size === 'small', uw = small ? 17 : 25, tw = small ? 5.4 : 7.4, aw = small ? 3.6 : 4.8, top = GROUND_Y - o.h;
  for (let i = 0; i < o.n; i++) {
    const x0 = o.x + i * uw, cx = x0 + uw / 2 + (small ? 0 : -.5), gr = c.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    gr.addColorStop(0, '#5fd08a'); gr.addColorStop(.5, '#2f9a5e'); gr.addColorStop(1, '#1b6a43');
    c.lineCap = 'round'; c.lineJoin = 'round';
    const limb = (pts, w) => { c.strokeStyle = gr; c.lineWidth = w; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.stroke(); };
    const ly = top + o.h * (small ? .42 : .4), ry = top + o.h * (small ? .56 : .52), lx = x0 + aw / 2, rx = x0 + uw - aw / 2;
    limb([[cx, top + tw / 2], [cx, GROUND_Y - tw / 2 + 1]], tw);
    limb([[cx, ly + 3], [lx, ly + 3], [lx, ly - o.h * .2]], aw);
    limb([[cx, ry + 3], [rx, ry + 3], [rx, ry - o.h * .22]], aw);
    c.strokeStyle = 'rgba(10,50,30,.35)'; c.lineWidth = .8; // ribs
    c.beginPath(); c.moveTo(cx, top + tw); c.lineTo(cx, GROUND_Y); c.moveTo(cx - tw * .28, top + tw); c.lineTo(cx - tw * .28, GROUND_Y); c.moveTo(cx + tw * .28, top + tw); c.lineTo(cx + tw * .28, GROUND_Y); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx - tw * .32, top + tw * .8); c.lineTo(cx - tw * .32, GROUND_Y - 3); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 6; k++) c.fillRect(cx - tw / 2 - 1 + hash(o.x + i + k) * (tw + 2), top + 4 + hash(k + i * 9) * (o.h - 8), .9, .9); // spines
    if (hash(Math.floor(o.x / 7) + i) < .45) { c.fillStyle = '#ff7fa8'; disc(c, cx, top - 1, 2.3); c.fillStyle = '#ffd1e0'; disc(c, cx, top - 1, 1); } // a flower on some
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x0 + uw / 2 + 2, GROUND_Y + 1.6, uw / 2, 1.8, 0, 0, TAU); c.fill();
  }
}

function bird(c, o, g) { // pterodactyl: body, beak, a wing that beats up and down
  const oy = GROUND_Y - o.y0 - o.h, ph = ((g.frame >> 2) & 3), wing = [-1, -.3, .9, .3][ph], bodyG = c.createLinearGradient(0, oy + 10, 0, oy + 30);
  bodyG.addColorStop(0, '#f0b26b'); bodyG.addColorStop(1, '#b3602d');
  c.save(); c.translate(o.x, oy); c.lineJoin = 'round'; c.lineCap = 'round';
  const wy = 16 + wing * -13; // wing tip height
  c.fillStyle = '#8c4a24'; c.beginPath(); c.moveTo(12, 20); c.quadraticCurveTo(18, wy, 29, wy - 2 * wing); c.quadraticCurveTo(28, 19, 30, 22); c.closePath(); c.fill(); // far wing
  c.fillStyle = bodyG; c.beginPath(); c.moveTo(4, 26); c.quadraticCurveTo(8, 17, 20, 17); c.quadraticCurveTo(33, 16, 38, 21); c.quadraticCurveTo(30, 30, 16, 30); c.quadraticCurveTo(9, 30, 4, 26); c.fill(); // body
  c.beginPath(); c.moveTo(4, 26); c.lineTo(-3, 30); c.lineTo(6, 28); c.closePath(); c.fill(); // tail
  c.beginPath(); c.moveTo(34, 20); c.quadraticCurveTo(38, 12, 42, 13); c.lineTo(45, 16); c.lineTo(38, 22); c.closePath(); c.fill(); // head
  c.fillStyle = '#e8c46a'; c.beginPath(); c.moveTo(43, 14); c.lineTo(50, 17); c.lineTo(42, 19); c.closePath(); c.fill(); // beak
  c.fillStyle = '#c95a38'; c.beginPath(); c.moveTo(38, 14); c.lineTo(31, 8); c.lineTo(36, 17); c.closePath(); c.fill(); // crest
  c.fillStyle = '#fff'; disc(c, 40.2, 15.6, 1.8); c.fillStyle = '#111'; disc(c, 40.8, 15.7, .9);
  const wg = c.createLinearGradient(0, 8, 0, 34); wg.addColorStop(0, '#ffd08a'); wg.addColorStop(1, '#d1793a');
  c.fillStyle = wg; c.beginPath(); c.moveTo(14, 22); c.quadraticCurveTo(20, wy - 6 * wing, 33, wy + 1); c.quadraticCurveTo(28, wy + 8 * (wing + 1) * .6 + 6, 26, 24); c.closePath(); c.fill(); // near wing
  c.strokeStyle = 'rgba(90,40,10,.4)'; c.lineWidth = .8; c.beginPath(); c.moveTo(16, 22); c.lineTo(31, wy + 1); c.stroke();
  c.restore();
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(o.x + 22, GROUND_Y + 2, 16, 2, 0, 0, TAU); c.fill();
}

// Draw one whole frame. `dead` tints the dino and shows the crash face; `flash` is 0..1 for the red flash on a crash.
export function drawScene(c, g, { dead = false, flash = 0 } = {}) {
  c.clearRect(0, 0, W, H);
  sky(c, g); clouds(c, g);
  hills(c, g, .12, 128, 34, '#1d2544', 1.3); hills(c, g, .3, 136, 22, '#2a2f55', 4.1);
  ground(c, g);
  for (const o of g.obstacles) if (o.kind !== 'bird') cactus(c, o);
  dust(c, g);
  const ducking = g.duck && g.y === 0, w = ducking ? DUCK_W : DINO_W, h = ducking ? DUCK_H : DINO_H, top = GROUND_Y - g.y - h;
  shadow(c, DINO_X + w / 2, w, g.y);
  if (ducking) dinoDuck(c, g, DINO_X, top, dead); else dinoStand(c, g, DINO_X, top, dead);
  for (const o of g.obstacles) if (o.kind === 'bird') bird(c, o, g);
  const vg = c.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, 'rgba(0,0,0,.18)'); vg.addColorStop(.3, 'rgba(0,0,0,0)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
  if (flash > 0) { c.fillStyle = `rgba(226,59,59,${.22 * flash})`; c.fillRect(0, 0, W, H); }
  c.fillStyle = '#e7ebf4'; c.font = '600 12px ui-monospace,monospace'; c.textAlign = 'right';
  c.fillText(String(Math.floor(g.dist * 0.025)).padStart(5, '0'), W - 10, 16);
}
