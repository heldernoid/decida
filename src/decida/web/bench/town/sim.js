// AI Town movement: citizens walk the streets between buildings, react to announcements, and go back to their routine. Pure logic.
import { roadPath, isRoad } from './town.js';

export const SPEED = 2.2;             // tiles per second
export const REACT_STAY = 9;          // seconds a citizen stays where a reaction took them before heading back
const centre = t => ({ x: t.x + 0.5, y: t.y + 0.5 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Put every citizen where they start: at the street beside their workplace or home, with a fixed little offset so people do not stack.
export function placeCitizens(citizens) {
  for (const c of citizens) {
    const p = centre(c.at.access);
    c.px = p.x; c.py = p.y; c.ox = ((c.id * 37) % 7 - 3) * 0.05; c.oy = ((c.id * 53) % 7 - 3) * 0.05;
    c.route = []; c.activity = 'routine'; c.timer = 2 + (c.id % 9); c.reaction = null; c.bubble = null; c.decision = null; c.face = 1; c.walk = 0;
  }
}

// Send a citizen to a building. Returns false if there is no way there (they stay put).
export function sendTo(c, town, building, mode = 'walking') {
  const from = { x: Math.max(0, Math.min(town.size - 1, Math.round(c.px - 0.5))), y: Math.max(0, Math.min(town.size - 1, Math.round(c.py - 0.5))) };
  const start = isRoad(from.x, from.y) ? from : c.at.access;
  const path = roadPath(start, building.access);
  if (!path.length) return false;
  c.route = path.slice(1).map(centre); c.target = building; c.activity = mode; return true;
}

// Advance one citizen by dt seconds. Calls onArrive(c) once when a walk ends.
export function step(c, dt, onArrive) {
  if (c.activity === 'walking' || c.activity === 'reacting-walk') {
    let move = SPEED * dt;
    while (move > 0 && c.route.length) {
      const next = c.route[0], d = dist({ x: c.px, y: c.py }, next);
      if (d <= move) { c.px = next.x; c.py = next.y; c.route.shift(); move -= d; }
      else { c.px += ((next.x - c.px) / d) * move; c.py += ((next.y - c.py) / d) * move; if (next.x !== c.px) c.face = next.x - c.px > 0 || next.y - c.py < 0 ? 1 : -1; move = 0; }
    }
    c.walk += dt * 9;
    if (!c.route.length) {
      c.at = c.target; const wasReaction = c.activity === 'reacting-walk';
      c.activity = wasReaction ? 'reacting' : 'routine'; c.timer = wasReaction ? REACT_STAY : 3 + (c.id % 7); c.walk = 0;
      if (onArrive) onArrive(c, wasReaction);
    }
  } else {
    c.timer -= dt;
  }
}

// Idle citizens now and then stroll to another place that suits them; reacting citizens go home to their routine after a while.
export function routine(c, town, citizens, rand) {
  if (c.activity === 'reacting' && c.timer <= 0) { c.bubble = null; c.reaction = null; sendTo(c, town, c.work.kind === 'park' ? c.work : (rand() < 0.5 ? c.home : c.work)); return; }
  if (c.activity !== 'routine' || c.timer > 0) return;
  const options = [c.home, c.work, town.buildings.filter(b => b.kind === 'park' && b.quarter === c.quarter)[0], town.buildings.find(b => b.kind === 'square')].filter(Boolean);
  const to = options[Math.floor(rand() * options.length)];
  if (to === c.at || !sendTo(c, town, to)) c.timer = 4 + rand() * 6;
}

// A citizen acts on a decision: walk to the target (investigate / join in / warn), or carry on. Returns true if they set off.
export function react(c, town, decision, target) {
  c.decision = decision; c.reaction = decision.action;
  c.bubble = { action: decision.action, at: 0 };
  if (!target || decision.action === 'carry_on') { c.activity = c.route.length ? c.activity : 'routine'; c.timer = Math.max(c.timer, 1); return false; }
  const ok = sendTo(c, town, target, 'reacting-walk');
  if (!ok) c.activity = 'routine';
  return ok;
}
