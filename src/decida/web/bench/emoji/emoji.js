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

// Country flags: kept out of EMOJIS on purpose. They're a real-world-association probe (does the model know a flag's
// colours/shape go with this country?), not part of the base "things you can search for" set, so they must not
// change the 60/120/all counts anyone is already using — a bench control opts them in explicitly, off by default.
// All 193 UN member states, by hand (deciding which countries belong and what to call them is the editorial part).
// A flag emoji is a fixed, unambiguous rendering of its ISO 3166-1 alpha-2 code (two "regional indicator" letters),
// not free text, so it is derived from the code instead of hand-typed 193 times over, which only risks transcription
// errors on a mapping that has exactly one correct answer.
const flagOf = code => [...code].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
const COUNTRIES = [
  ['AF', 'afghanistan'], ['AL', 'albania'], ['DZ', 'algeria'], ['AD', 'andorra'], ['AO', 'angola'], ['AG', 'antigua and barbuda'],
  ['AR', 'argentina'], ['AM', 'armenia'], ['AU', 'australia'], ['AT', 'austria'], ['AZ', 'azerbaijan'], ['BS', 'bahamas'],
  ['BH', 'bahrain'], ['BD', 'bangladesh'], ['BB', 'barbados'], ['BY', 'belarus'], ['BE', 'belgium'], ['BZ', 'belize'],
  ['BJ', 'benin'], ['BT', 'bhutan'], ['BO', 'bolivia'], ['BA', 'bosnia and herzegovina'], ['BW', 'botswana'], ['BR', 'brazil'],
  ['BN', 'brunei'], ['BG', 'bulgaria'], ['BF', 'burkina faso'], ['BI', 'burundi'], ['CV', 'cabo verde'], ['KH', 'cambodia'],
  ['CM', 'cameroon'], ['CA', 'canada'], ['CF', 'central african republic'], ['TD', 'chad'], ['CL', 'chile'], ['CN', 'china'],
  ['CO', 'colombia'], ['KM', 'comoros'], ['CG', 'congo-brazzaville'], ['CD', 'congo-kinshasa'], ['CR', 'costa rica'],
  ['HR', 'croatia'], ['CU', 'cuba'], ['CY', 'cyprus'], ['CZ', 'czechia'], ['DK', 'denmark'], ['DJ', 'djibouti'],
  ['DM', 'dominica'], ['DO', 'dominican republic'], ['EC', 'ecuador'], ['EG', 'egypt'], ['SV', 'el salvador'],
  ['GQ', 'equatorial guinea'], ['ER', 'eritrea'], ['EE', 'estonia'], ['SZ', 'eswatini'], ['ET', 'ethiopia'], ['FJ', 'fiji'],
  ['FI', 'finland'], ['FR', 'france'], ['GA', 'gabon'], ['GM', 'gambia'], ['GE', 'georgia'], ['DE', 'germany'], ['GH', 'ghana'],
  ['GR', 'greece'], ['GD', 'grenada'], ['GT', 'guatemala'], ['GN', 'guinea'], ['GW', 'guinea-bissau'], ['GY', 'guyana'],
  ['HT', 'haiti'], ['HN', 'honduras'], ['HU', 'hungary'], ['IS', 'iceland'], ['IN', 'india'], ['ID', 'indonesia'],
  ['IR', 'iran'], ['IQ', 'iraq'], ['IE', 'ireland'], ['IL', 'israel'], ['IT', 'italy'], ['CI', 'ivory coast'],
  ['JM', 'jamaica'], ['JP', 'japan'], ['JO', 'jordan'], ['KZ', 'kazakhstan'], ['KE', 'kenya'], ['KI', 'kiribati'],
  ['KW', 'kuwait'], ['KG', 'kyrgyzstan'], ['LA', 'laos'], ['LV', 'latvia'], ['LB', 'lebanon'], ['LS', 'lesotho'],
  ['LR', 'liberia'], ['LY', 'libya'], ['LI', 'liechtenstein'], ['LT', 'lithuania'], ['LU', 'luxembourg'],
  ['MG', 'madagascar'], ['MW', 'malawi'], ['MY', 'malaysia'], ['MV', 'maldives'], ['ML', 'mali'], ['MT', 'malta'],
  ['MH', 'marshall islands'], ['MR', 'mauritania'], ['MU', 'mauritius'], ['MX', 'mexico'], ['FM', 'micronesia'],
  ['MD', 'moldova'], ['MC', 'monaco'], ['MN', 'mongolia'], ['ME', 'montenegro'], ['MA', 'morocco'], ['MZ', 'mozambique'],
  ['MM', 'myanmar'], ['NA', 'namibia'], ['NR', 'nauru'], ['NP', 'nepal'], ['NL', 'netherlands'], ['NZ', 'new zealand'],
  ['NI', 'nicaragua'], ['NE', 'niger'], ['NG', 'nigeria'], ['KP', 'north korea'], ['MK', 'north macedonia'], ['NO', 'norway'],
  ['OM', 'oman'], ['PK', 'pakistan'], ['PW', 'palau'], ['PA', 'panama'], ['PG', 'papua new guinea'], ['PY', 'paraguay'],
  ['PE', 'peru'], ['PH', 'philippines'], ['PL', 'poland'], ['PT', 'portugal'], ['QA', 'qatar'], ['RO', 'romania'],
  ['RU', 'russia'], ['RW', 'rwanda'], ['KN', 'saint kitts and nevis'], ['LC', 'saint lucia'],
  ['VC', 'saint vincent and the grenadines'], ['WS', 'samoa'], ['SM', 'san marino'], ['ST', 'sao tome and principe'],
  ['SA', 'saudi arabia'], ['SN', 'senegal'], ['RS', 'serbia'], ['SC', 'seychelles'], ['SL', 'sierra leone'],
  ['SG', 'singapore'], ['SK', 'slovakia'], ['SI', 'slovenia'], ['SB', 'solomon islands'], ['SO', 'somalia'],
  ['ZA', 'south africa'], ['KR', 'south korea'], ['SS', 'south sudan'], ['ES', 'spain'], ['LK', 'sri lanka'],
  ['SD', 'sudan'], ['SR', 'suriname'], ['SE', 'sweden'], ['CH', 'switzerland'], ['SY', 'syria'], ['TJ', 'tajikistan'],
  ['TZ', 'tanzania'], ['TH', 'thailand'], ['TL', 'timor-leste'], ['TG', 'togo'], ['TO', 'tonga'],
  ['TT', 'trinidad and tobago'], ['TN', 'tunisia'], ['TR', 'turkey'], ['TM', 'turkmenistan'], ['TV', 'tuvalu'],
  ['UG', 'uganda'], ['UA', 'ukraine'], ['AE', 'united arab emirates'], ['GB', 'united kingdom'], ['US', 'united states'],
  ['UY', 'uruguay'], ['UZ', 'uzbekistan'], ['VU', 'vanuatu'], ['VE', 'venezuela'], ['VN', 'vietnam'], ['YE', 'yemen'],
  ['ZM', 'zambia'], ['ZW', 'zimbabwe'],
];
export const FLAGS = G('country flags', COUNTRIES.map(([code, name]) => [flagOf(code), `${name} flag`]));

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

// An additional strategy: one `choice` question with every emoji as an option, instead of one yes/no question per
// emoji. A choice question forces a softmax over the whole candidate set, so it can come out more decisive than
// many independent yes/no calls (each of which can land near 50/50 on its own) — but it is one shared judgement,
// not `n` independent ones, so its shape suits "which one is closest" better than "how many of these match".
export const MAX_CHOICE_OPTIONS = 255; // the choice question type's own limit
export function toRequestChoice(query, items) {
  const q = String(query).trim();
  if (!q) throw new Error('type something first');
  if (items.length < 2 || items.length > MAX_CHOICE_OPTIONS) throw new Error(`a choice question takes 2-${MAX_CHOICE_OPTIONS} emoji`);
  if (new Set(items.map(e => e.name)).size !== items.length) throw new Error('emoji names must be unique for the choice strategy');
  return { state: q, questions: { pick: { type: 'choice', instructions: 'Which of these best matches this?', criteria: Object.fromEntries(items.map(e => [e.name, null])) } } };
}

// Same {...e, index, p} shape as scores(), read from the one choice answer's probabilities (keyed by name) instead
// of one noul answer per emoji, so every downstream function (pickMatches, targets, ...) works unchanged.
export function scoresFromChoice(answer, items) {
  const probs = answer.pick.probabilities;
  return items.map((e, i) => ({ ...e, index: i, p: Math.min(1, Math.max(0, +(probs[e.name] || 0))) }));
}

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
