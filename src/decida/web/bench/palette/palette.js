// Colour palette bench: type a phrase, get the colours a model associates with it, as stripes whose widths are probabilities.
// The phrase is the text (the state) and one `choice` question asks which colour it makes you think of. Every option is described
// by what that colour looks like in real life ("red, the colour of tomatoes, fire trucks, roses, blood"), because the description
// is what the model matches the text against. Twelve colours, not twenty-four: option lists must stay short (and fit the encoder's
// 192-token option budget). Measured on 16 queries with known colours: this took DecidaBERT-large from 4/12 to 10/12 top-1 on single-colour
// queries, and its probability on the right colour from 19% to 75% (bare colour names were near chance).
// Pure logic, no DOM: runs in the browser and under node.
// The idea follows Matt DesLauriers' "does Jev understand colour?" demo (https://x.com/mattdesl/status/2100899669802963060);
// no code from it is used. The described-options and option-order lessons come from the Laya playground guide (MIT, THIRD_PARTY.md).

export const PALETTE = [
  ['red', '#dd1600', 'tomatoes, fire trucks, roses, blood'], ['orange', '#ff7a00', 'oranges, pumpkins, carrots, sunsets'], ['yellow', '#ffd000', 'bananas, lemons, sunflowers, the sun'],
  ['green', '#00a832', 'grass, leaves, frogs, emeralds'], ['teal', '#12c5a0', 'tropical shallow water, peacock feathers'], ['blue', '#0a84ff', 'the ocean, jeans, sapphires'],
  ['purple', '#8620b8', 'grapes, violets, royalty'], ['pink', '#ff8ccf', 'bubblegum, flamingos, cherry blossom'], ['brown', '#7a4a24', 'chocolate, wood, soil, coffee'],
  ['grey', '#8a8a8a', 'clouds, rain, concrete, ash'], ['black', '#000000', 'night, coal, ink'], ['white', '#ffffff', 'snow, milk, paper'],
].map(([name, hex, typical]) => ({ name, hex, typical }));
export const MAX_COLOURS = 26; // the LM backend reads one letter per option

// 'single': one question. 'rotated': the same question asked with the option list rotated by fixed steps, in one request, and averaged.
// Language models read options as letters and favour the first ones; rotating puts every colour at evenly spread positions, which
// cancels that bias (Qwen3-0.6B: 8/12 -> 11/12 top-1 on single-colour queries with four rotations, at four times the work).
// Random shuffles were erratic (the same model said "white" for tomato with some permutations); rotations are not.
export const METHODS = { single: 'one question', rotated: 'averaged over rotated option orders' };
export const COPIES = 4;

const INSTRUCTIONS = 'Which colour does this make you think of?';
const option = c => `${c.name}, the colour of ${c.typical}`;

const rotate = (a, k) => a.map((_, i) => a[(i + k) % a.length]);

export function toRequest(phrase, method = 'single', copies = COPIES) {
  const text = String(phrase).trim();
  if (!text) throw new Error('type something first');
  const q = order => ({ type: 'choice', instructions: INSTRUCTIONS, criteria: Object.fromEntries(order.map(c => [c.name, option(c)])) });
  if (method === 'rotated') { const step = PALETTE.length / copies; return { state: text, questions: Object.fromEntries(Array.from({ length: copies }, (_, k) => [`o${k}`, q(rotate(PALETTE, Math.round(k * step)))])) }; }
  return { state: text, questions: { colour: q(PALETTE) } };
}

// Shares (sum 1) for every palette colour, largest first; rotated answers are averaged.
export function shares(answers, method = 'single') {
  const keys = method === 'rotated' ? Object.keys(answers) : ['colour'];
  const raw = PALETTE.map(c => keys.reduce((a, k) => a + (answers[k].probabilities[c.name] || 0), 0) / keys.length);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return PALETTE.map((c, i) => ({ ...c, share: raw[i] / total })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

// Contrast: raise every share to a power and renormalise. The ranking never changes; a flat distribution (a model that is right about
// which colours belong but unsure how much) becomes a decisive one. Measured on 14 phrases with well-known colours, DecidaBERT-large has a right
// colour in its top 3 for 12 of them but only 23% on its top colour, so sharpening x4 lifts its probability on the right colours from
// 33% to 46% without touching the order. A model that is confident already (Jev: 90% on top) needs none.
export function sharpen(list, gamma = 1) {
  if (gamma === 1) return list;
  const raised = list.map(c => c.share ** gamma), total = raised.reduce((a, b) => a + b, 0) || 1;
  return list.map((c, i) => ({ ...c, share: raised[i] / total })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}
export const GAMMAS = [1, 2, 3, 4, 6];
// The gentlest contrast that lets the top colour reach `target` (or the strongest available).
export function autoGamma(list, target = 0.5) {
  for (const g of GAMMAS) if (sharpen(list, g)[0].share >= target) return g;
  return GAMMAS[GAMMAS.length - 1];
}

// Stripes to draw: colours above `minShare`, widths renormalised to 100%, plus how many slivers were dropped.
export function layout(list, minShare = 0.004) {
  const shown = list.filter(c => c.share >= minShare), total = shown.reduce((a, c) => a + c.share, 0) || 1;
  let left = 0;
  const stripes = shown.map(c => { const width = (100 * c.share) / total, s = { ...c, left, width }; left += width; return s; });
  return { stripes, hidden: list.length - shown.length };
}

// Readable text on a stripe: dark on light colours, light on dark ones.
export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), lum = (((n >> 16) & 255) * .299 + ((n >> 8) & 255) * .587 + ((n) & 255) * .114);
  return lum > 150 ? '#111' : '#fff';
}
