// A tiny 2D world of circles: gravity, a floor, walls and circle-circle collisions. Bodies with a `lift` target ignore
// gravity and collisions and are pulled to it by a damped spring; clearing `lift` lets them fall back into the pile.
// Pure logic, no DOM.
export const FRICTION = 0.995, REST = 16, GRAVITY = 1500, FLOOR_BOUNCE = 0.18, DAMPING = 0.996;

export function makeWorld(W, H, n, radius, seed = 1) {
  let a = seed >>> 0; const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bodies = Array.from({ length: n }, (_, i) => ({ id: i, x: radius + rand() * (W - 2 * radius), y: -rand() * 1400 - radius, vx: (rand() - .5) * 60, vy: 0, r: radius, lift: null }));
  return { W, H, floor: H - 10, bodies };
}

// Position-based dynamics: bodies are moved apart to resolve overlaps and velocity is then derived from the actual movement,
// which lets a pile come to rest (impulse-based resolution keeps resting stacks vibrating).
function collide(bs) {
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i]; if (a.lift) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j]; if (b.lift) continue;
      const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
      if (dx > min || dx < -min || dy > min || dy < -min) continue;
      const d2 = dx * dx + dy * dy; if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001, push = (min - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      a.touch = b.touch = true;
    }
  }
}

export function step(w, dt) {
  const sub = 4, h = Math.min(dt, 1 / 30) / sub, K = 110, C = 2 * Math.sqrt(K);
  for (let s = 0; s < sub; s++) {
    for (const b of w.bodies) {
      b.px = b.x; b.py = b.y; b.touch = false;
      if (b.lift) { b.vx += (K * (b.lift.x - b.x) - C * b.vx) * h; b.vy += (K * (b.lift.y - b.y) - C * b.vy) * h; }
      else b.vy += GRAVITY * h;
      b.x += b.vx * h; b.y += b.vy * h;
    }
    for (let pass = 0; pass < 4; pass++) {
      collide(w.bodies);
      for (const b of w.bodies) {
        if (b.lift) continue;
        if (b.y + b.r > w.floor) { b.y = w.floor - b.r; b.floorHit = Math.max(b.floorHit || 0, b.vy); b.touch = true; }
        if (b.x - b.r < 0) b.x = b.r;
        if (b.x + b.r > w.W) b.x = w.W - b.r;
      }
    }
    for (const b of w.bodies) {
      if (b.lift) continue;
      b.vx = (b.x - b.px) / h; b.vy = (b.y - b.py) / h;
      if (b.floorHit) { if (b.floorHit > 220) b.vy = -b.floorHit * FLOOR_BOUNCE; b.floorHit = 0; }
      if (b.touch) { b.vx *= FRICTION; b.vy *= 0.98; }  // friction against the floor and neighbours
      b.vx *= DAMPING;
      if (b.touch && b.vx * b.vx + b.vy * b.vy < REST) { b.vx *= 0.5; b.vy *= 0.5; } // touching and nearly still: come to rest (never in mid-air)
    }
  }
}
