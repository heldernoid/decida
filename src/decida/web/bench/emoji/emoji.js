// Emoji finder: a pile of emoji; type a query and the ones that match float up out of it.
// Every emoji is one yes/no question ("is a glove a good match for the query?"), all in one batched request.
// Pure logic, no DOM: runs in the browser and under node. The idea follows a public Jev demo ("when a designer gets access to Jev",
// https://x.com/heystefan_); no code from it is used.

// [character, plain-English name], grouped by what kind of thing it is. Written by hand; names are what the model reads.
const G = (group, pairs) => pairs.map(([char, name]) => ({ char, name, group }));
export const EMOJIS = [
  // clothing
  ...G('clothing', [
  ['🧤', 'glove'], ['🧣', 'scarf'], ['🧦', 'socks'], ['🥾', 'hiking boot'], ['👢', 'boot'], ['👟', 'sneaker'], ['👠', 'high heel'], ['🩴', 'flip flop'],
  ['🧢', 'baseball cap'], ['🎩', 'top hat'], ['👒', 'sun hat'], ['👕', 't-shirt'], ['👖', 'jeans'], ['👗', 'dress'], ['🩳', 'shorts'], ['👙', 'bikini'],
  ['🧥', 'coat'], ['🥼', 'lab coat'], ['👔', 'necktie'], ['👓', 'glasses'], ['🕶️', 'sunglasses'], ['💍', 'ring'], ['👜', 'handbag'], ['🎒', 'backpack'],
  ]),
  // weather and nature
  ...G('weather and nature', [
  ['☀️', 'sun'], ['🌙', 'crescent moon'], ['⭐', 'star'], ['☁️', 'cloud'], ['🌧️', 'rain cloud'], ['⛈️', 'thunderstorm'], ['❄️', 'snowflake'], ['☃️', 'snowman'],
  ['🔥', 'fire'], ['💧', 'water drop'], ['🌈', 'rainbow'], ['🌊', 'wave'], ['🌪️', 'tornado'], ['🌋', 'volcano'], ['🏔️', 'snowy mountain'], ['🌵', 'cactus'],
  ['🌲', 'pine tree'], ['🌴', 'palm tree'], ['🌻', 'sunflower'], ['🌹', 'rose'], ['🍄', 'mushroom'], ['🍁', 'maple leaf'], ['🌍', 'globe'],
  ]),
  // food and drink
  ...G('food and drink', [
  ['🍎', 'apple'], ['🍌', 'banana'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🍊', 'orange'], ['🍋', 'lemon'], ['🍑', 'peach'], ['🍒', 'cherries'],
  ['🥑', 'avocado'], ['🍅', 'tomato'], ['🥕', 'carrot'], ['🌽', 'corn'], ['🥦', 'broccoli'], ['🌶️', 'chili pepper'], ['🍞', 'bread'], ['🧀', 'cheese'],
  ['🥚', 'egg'], ['🥓', 'bacon'], ['🍔', 'hamburger'], ['🍕', 'pizza'], ['🌭', 'hot dog'], ['🌮', 'taco'], ['🍣', 'sushi'], ['🍜', 'noodles'],
  ['🍦', 'ice cream'], ['🍩', 'doughnut'], ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🍫', 'chocolate'], ['🍿', 'popcorn'], ['☕', 'coffee'],
  ['🍺', 'beer'], ['🍷', 'wine glass'], ['🥛', 'milk'], ['🍯', 'honey'], ['🥐', 'croissant'],
  ]),
  // animals
  ...G('animals', [
  ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐰', 'rabbit'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'],
  ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'], ['🦆', 'duck'],
  ['🦉', 'owl'], ['🦇', 'bat'], ['🐺', 'wolf'], ['🐴', 'horse'], ['🦄', 'unicorn'], ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐌', 'snail'], ['🐢', 'turtle'],
  ['🐍', 'snake'], ['🐙', 'octopus'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🦈', 'shark'], ['🐟', 'fish'], ['🐘', 'elephant'], ['🦒', 'giraffe'],
  ['🐪', 'camel'], ['🦖', 't-rex'], ['🐜', 'ant'], ['🕷️', 'spider'],
  ]),
  // tools and objects
  ...G('tools and objects', [
  ['🔨', 'hammer'], ['🔧', 'wrench'], ['🪓', 'axe'], ['✂️', 'scissors'], ['📎', 'paperclip'], ['🔑', 'key'], ['🔒', 'lock'], ['💡', 'light bulb'],
  ['🔦', 'flashlight'], ['🔋', 'battery'], ['🧲', 'magnet'], ['🧭', 'compass'], ['⏰', 'alarm clock'], ['📷', 'camera'], ['📱', 'phone'], ['💻', 'laptop'],
  ['🎮', 'game controller'], ['🎧', 'headphones'], ['📚', 'books'], ['✏️', 'pencil'], ['🖊️', 'pen'], ['📌', 'pushpin'], ['🧪', 'test tube'],
  ['🔬', 'microscope'], ['🔭', 'telescope'], ['🧸', 'teddy bear'], ['🎁', 'gift'], ['🎈', 'balloon'], ['🕯️', 'candle'], ['🛏️', 'bed'], ['🪑', 'chair'],
  ['🚪', 'door'], ['🧹', 'broom'], ['🧼', 'soap'], ['🪥', 'toothbrush'], ['☂️', 'umbrella'], ['💰', 'money bag'], ['💎', 'gem'], ['🪙', 'coin'], ['📦', 'package'],
  ]),
  // vehicles
  ...G('vehicles', [
  ['🚗', 'car'], ['🚌', 'bus'], ['🚲', 'bicycle'], ['✈️', 'airplane'], ['🚀', 'rocket'], ['⛵', 'sailboat'], ['🚂', 'train'], ['🛵', 'scooter'],
  ['🚁', 'helicopter'], ['🚜', 'tractor'], ['🚒', 'fire truck'], ['🚑', 'ambulance'],
  ]),
  // sport, music and games
  ...G('sport, music and games', [
  ['⚽', 'soccer ball'], ['🏀', 'basketball'], ['🎾', 'tennis ball'], ['🏈', 'american football'], ['🥊', 'boxing glove'], ['⛷️', 'skier'], ['🏂', 'snowboarder'],
  ['⛸️', 'ice skate'], ['🏆', 'trophy'], ['🎸', 'guitar'], ['🥁', 'drum'], ['🎹', 'piano'], ['🎺', 'trumpet'], ['🎻', 'violin'], ['🎨', 'paint palette'],
  ['🎭', 'theatre masks'], ['🎬', 'clapperboard'],
  ]),
  // places and other things
  ...G('places and other things', [
  ['🏠', 'house'], ['⛺', 'tent'], ['🏰', 'castle'], ['🗽', 'statue of liberty'], ['🗼', 'tower'], ['🌉', 'bridge'], ['⛪', 'church'], ['⚓', 'anchor'],
  ['🎃', 'pumpkin'], ['🎄', 'christmas tree'], ['🎅', 'santa claus'], ['👻', 'ghost'], ['💀', 'skull'], ['👽', 'alien'], ['🤖', 'robot'], ['❤️', 'heart'],
  ['💔', 'broken heart'], ['🔔', 'bell'], ['🏁', 'chequered flag'], ['🚩', 'red flag'],
  ]),
];

// A deterministic subset of `n` emoji (or all of them), so a smaller pile is the same pile every time.
export function subset(n, items = EMOJIS) {
  if (n >= items.length) return items.slice();
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

export const MAX_QUESTIONS = 256; // API limit per request

// The query is the text (the state) and each emoji is a short statement about it: "A glove is an example of this." Measured on
// 10 queries with known answers over all 211 emoji, this beat the longer "is a good match for ..." wording (68% vs 58% precision@k
// for DecidaBERT-large) and uses a third fewer tokens; putting the hypothesis in the options instead was much worse (10%).
const article = name => (/^[aeiou]/.test(name) ? 'An ' : 'A ') + name;

export function toRequest(query, items) {
  const q = String(query).trim();
  if (!q) throw new Error('type something first');
  if (items.length < 1 || items.length > MAX_QUESTIONS) throw new Error(`a request takes 1-${MAX_QUESTIONS} emoji`);
  const questions = {};
  items.forEach((e, i) => { questions[`e${i}`] = { type: 'noul', instructions: `${article(e.name)} is an example of this.` }; });
  return { state: q, questions };
}

// Probability of a match for every emoji, in the order of `items`.
export const scores = (answers, items) => items.map((e, i) => ({ ...e, index: i, p: Math.min(1, Math.max(0, +answers[`e${i}`].noul)) }));

// The emoji that float up: probability at or above `threshold`, best first, at most `max`.
export function matches(list, threshold = 0.5, max = 24) {
  return list.filter(e => e.p >= threshold).sort((a, b) => b.p - a.p || a.index - b.index).slice(0, max);
}

// The k most likely emoji whatever their probability: fair to models that answer "yes" (or "no") to almost everything.
export function topK(list, k = 8) {
  return list.slice().sort((a, b) => b.p - a.p || a.index - b.index).slice(0, k);
}

const median = xs => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

// How well a model tells emoji apart: the median answer (what "no idea" looks like for it) and how far the best sits above it.
export function signal(list) {
  const m = median(list.map(e => e.p)), top = list.reduce((a, e) => Math.max(a, e.p), 0);
  return { median: m, spread: top - m };
}

// Which emoji float up. 'thr': at least `thr`. 'top': the k most likely. 'auto' (default): a cut-off when the model separates
// emoji clearly, otherwise the k most likely, with a note saying why (small models often answer ~50% for everything, or ~0%).
export function pickMatches(list, rule = 'auto', thr = 0.5, k = 8, max = 24) {
  const sig = signal(list), pct = v => Math.round(100 * v);
  if (rule === 'thr') return { hit: matches(list, thr, max), mode: 'threshold', note: '', ...sig };
  if (rule === 'top') return { hit: topK(list, k), mode: 'rank', note: '', ...sig };
  if (sig.median >= 0.3) return { hit: topK(list, k), mode: 'rank', note: `This model answers about ${pct(sig.median)}% for almost everything, so a cut-off would float noise. Showing its ${k} most likely instead.`, ...sig };
  const hit = matches(list, thr, max);
  if (!hit.length) return { hit: topK(list, k), mode: 'rank', note: `Nothing reached ${pct(thr)}%. Showing the ${k} most likely instead.`, ...sig };
  return { hit, mode: 'threshold', note: '', ...sig };
}

// Where matches hover: rows centred horizontally, best first from the middle out.
export function targets(count, W = 900, y0 = 150, gap = 62, perRow = 12) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow), inRow = Math.min(perRow, count - row * perRow), col = i % perRow;
    out.push({ x: W / 2 + (col - (inRow - 1) / 2) * gap, y: y0 + row * gap });
  }
  return out;
}
