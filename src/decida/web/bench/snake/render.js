// Geometry for drawing the snake as one smooth tube: tween the body between two moves, then sample a rounded path through it.
// Pure logic, no DOM: runs in the browser and under node.

// Where the same segments were before the move, so they can slide instead of jump. `before` and `after` are head-first
// lists of cells. If the snake grew, the new last segment starts where the old tail was.
export function alignPrev(before, after) {
  const prev = before.map(c => ({ x: c.x, y: c.y }));
  while (prev.length < after.length) prev.push({ ...prev[prev.length - 1] });
  return prev.slice(0, after.length);
}

// Segment centres (in cell units, +0.5 so they sit mid-cell) at progress u in [0, 1] between `prev` and `cur`.
export function lerpBody(prev, cur, u) {
  const t = Math.min(1, Math.max(0, u));
  return cur.map((c, i) => { const p = prev[i] || c; return { x: p.x + (c.x - p.x) * t + 0.5, y: p.y + (c.y - p.y) * t + 0.5 }; });
}

// Points along a path that passes through the first and last centre and rounds every corner in between (quadratic curves
// through the midpoints), each with s in [0, 1] = fraction of the way from head to tail.
export function smoothPath(pts, perSegment = 8) {
  if (!pts.length) return [];
  if (pts.length === 1) return [{ x: pts[0].x, y: pts[0].y, s: 0 }];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), out = [];
  const quad = (p0, c, p1) => { for (let k = 0; k < perSegment; k++) { const t = k / perSegment, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; out.push({ x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y }); } };
  let start = pts[0];
  for (let i = 1; i < pts.length - 1; i++) { const m = mid(pts[i], pts[i + 1]); quad(start, pts[i], m); start = m; }
  quad(start, mid(start, pts[pts.length - 1]), pts[pts.length - 1]);
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out.map((p, i) => ({ ...p, s: i / (out.length - 1) }));
}

// Body radius (in cells) at s along the snake: full near the head, tapering to the tail.
export const radiusAt = (s, cell = 1) => cell * 0.37 * (1 - 0.42 * s * s);

// Heading of the head in radians, from the first two segment centres (0 = right, PI/2 = down).
export const heading = pts => (pts.length > 1 ? Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x) : 0);
