// Seeded PRNG shared by the bench games (deterministic courses and boards).
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seed from the control's text: a positive number replays that game; anything else ("random", empty) picks a fresh one.
export function pickSeed(value) {
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1 + Math.floor(Math.random() * 999999);
}
