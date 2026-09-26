// Colour sorter: a pile of candies, five bowls, and a model that says which bowl each candy belongs in.
// Every candy is one tiny `choice` question; a request carries a whole batch (up to 256), so this bench measures
// throughput, batching, latency, cost and accuracy rather than planning. Pure logic, no DOM: runs in the browser and under node.
// The idea (a chopstick colour sorter run against a hosted System One model) follows TypeSafe's public sorting demo.
import { rng } from '../common/rng.js';

export const BUCKETS = ['red', 'orange', 'yellow', 'green', 'purple'];
export const CENTER_HUE = { red: 355, orange: 28, yellow: 52, green: 130, purple: 285 }; // degrees
export const HUE_SIGMA = { easy: 4, normal: 6, hard: 9 };                                  // spread of a colour's hue
export const MAX_BATCH = 256;                                                              // questions per request (API limit)

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(t => Math.round((t + m) * 255));
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

// Deterministic balls: true colour (round-robin shuffled), hue jittered around the colour's centre, random saturation and brightness.
export function makeBalls(seed = 1, n = 1000, difficulty = 'normal') {
  const r = rng(seed), sigma = HUE_SIGMA[difficulty] ?? HUE_SIGMA.normal, gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const balls = [];
  for (let i = 0; i < n; i++) {
    const color = BUCKETS[Math.floor(r() * BUCKETS.length)];
    const hue = (CENTER_HUE[color] + gauss() * sigma + 360) % 360, sat = 0.65 + r() * 0.35, val = 0.65 + r() * 0.35;
    const rgb = hsvToRgb(hue, sat, val), [h, s, v] = rgbToHsv(...rgb); // what a sensor would read (rounded)
    balls.push({ id: i, color, rgb, hue: Math.round(h), sat: s, val: v });
  }
  return balls;
}

// Reference rule: the bowl whose hue centre is nearest to the reading.
export const oracle = ball => BUCKETS.reduce((best, c) => (hueDist(ball.hue, CENTER_HUE[c]) < hueDist(ball.hue, CENTER_HUE[best]) ? c : best), BUCKETS[0]);

const HUE_NAMES = [[345, 'red'], [15, 'red-orange'], [22, 'orange'], [38, 'orange-yellow'], [45, 'yellow'], [65, 'yellow-green'], [90, 'green'], [170, 'blue-green'],
  [250, 'blue-violet'], [265, 'purple'], [320, 'magenta']];
export function hueName(h) {
  if (h >= 345 || h < 15) return 'red';
  let name = 'red-orange';
  for (const [start, n] of HUE_NAMES.slice(1)) if (h >= start) name = n; // ascending starts from 15 up to 320
  return name;
}

// Boundaries halfway between neighbouring hue centres, for the guide variant.
export function boundaries() {
  const cs = BUCKETS.map(c => [c, CENTER_HUE[c]]).sort((a, b) => a[1] - b[1]);
  return cs.map(([c, h], i) => { const next = cs[(i + 1) % cs.length][1], mid = (((h + ((next - h + 360) % 360) / 2) % 360) + 360) % 360; return [c, mid]; });
}
const GUIDE = () => {
  // range for each colour: from the midpoint before it to the midpoint after it
  const b = Object.fromEntries(boundaries().map(([c, m]) => [c, Math.round(m)])); // c -> upper edge (midpoint to the next colour)
  const order = BUCKETS.map(c => [c, CENTER_HUE[c]]).sort((a, z) => a[1] - z[1]).map(x => x[0]);
  return order.map((c, i) => `${c} ${b[order[(i + order.length - 1) % order.length]]}-${b[c]}`).join(', ');
};

const CRITERIA = { red: 'Red candies', orange: 'Orange candies', yellow: 'Yellow candies', green: 'Green candies', purple: 'Purple candies' };

// hints: 'rgb'   = the RGB reading only
//        'name'  = the colour in words ("a bright orange-yellow candy"), the way a person would say it
//        'guide' = RGB plus its hue in degrees, and a hue guide for the five bowls (the game does the measuring)
export function reading(ball, hints) {
  const [r, g, b] = ball.rgb;
  if (hints === 'name') return `A ${ball.val > 0.9 ? 'bright ' : ball.val < 0.75 ? 'deep ' : ''}${hueName(ball.hue)} candy.`;
  if (hints === 'guide') return `Candy #${ball.id} reads RGB(${r}, ${g}, ${b}), hue ${ball.hue} degrees.`;
  return `Candy #${ball.id} reads RGB(${r}, ${g}, ${b}).`;
}

// One request for a batch of balls: a shared state and one choice question per ball.
export function toRequest(balls, hints = 'rgb') {
  if (!balls.length || balls.length > MAX_BATCH) throw new Error(`a batch has 1-${MAX_BATCH} balls`);
  const state = 'Candies are being sorted by colour into five bowls, one candy at a time.' + (hints === 'guide' ? ` Hue guide in degrees (0-360): ${GUIDE()}.` : '');
  const questions = {};
  for (const b of balls) questions[`b${b.id}`] = { type: 'choice', instructions: `${reading(b, hints)} Which bowl does it belong in?`, criteria: { ...CRITERIA } };
  return { state, questions };
}

export function batches(balls, size) {
  const out = [];
  for (let i = 0; i < balls.length; i += size) out.push(balls.slice(i, i + Math.min(size, MAX_BATCH)));
  return out;
}

// Confusion matrix: rows are the true colour, columns the bowl the model chose.
export function confusion(pairs) {
  const m = Object.fromEntries(BUCKETS.map(t => [t, Object.fromEntries(BUCKETS.map(p => [p, 0]))]));
  for (const [truth, pred] of pairs) if (m[truth] && pred in m[truth]) m[truth][pred]++;
  return m;
}
export const purity = m => { let ok = 0, all = 0; for (const t of BUCKETS) for (const p of BUCKETS) { all += m[t][p]; if (t === p) ok += m[t][p]; } return all ? ok / all : 0; };
