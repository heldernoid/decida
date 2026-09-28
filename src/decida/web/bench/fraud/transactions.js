// Live fraud gate: card transactions arrive one at a time, each needing a decision before the next one lands —
// unlike Inbox's one big batch, this is the shape that makes latency itself the headline number: a real checkout
// cannot wait on a slow model. Every transaction has explicit structured fields; the correct verdict is computed
// from those fields by a documented rule (an executable oracle), not hand-labelled by feel.
// Pure logic, no DOM: runs in the browser and under node.

export const CATEGORIES = {
  groceries: { risk: 0 }, coffee: { risk: 0 }, restaurant: { risk: 0 }, gas: { risk: 0 }, pharmacy: { risk: 0 },
  subscription: { risk: 0 }, clothing: { risk: 1 }, electronics: { risk: 1 }, travel: { risk: 1 },
  jewelry: { risk: 2 }, 'gift cards': { risk: 2 }, 'wire transfer': { risk: 2 }, 'cash withdrawal': { risk: 2 },
};

// The oracle: a small, documented point score from the transaction's own fields, thresholded into a verdict.
// +2 very large for this cardholder, +1 moderately large; +2 foreign and a merchant never used before, +1 either
// alone; +1 for the small hours (midnight-5am); +2 for a high-risk category, +1 for a moderate one.
export function riskScore(tx) {
  let s = 0;
  if (tx.amount > tx.typical * 6) s += 2; else if (tx.amount > tx.typical * 2) s += 1;
  if (tx.foreign && !tx.familiar) s += 2; else if (tx.foreign || !tx.familiar) s += 1;
  if (tx.hour >= 0 && tx.hour < 5) s += 1;
  s += CATEGORIES[tx.category].risk;
  return s;
}
export function oracle(tx) {
  const s = riskScore(tx);
  return s >= 5 ? 'decline' : s >= 3 ? 'flag' : 'approve';
}

// Amount, familiarity and hour are put in words, not raw digits: encoder models read state-in-words far better
// than they compare magnitudes from numerals (see the main project's README, "Writing questions that work"). The
// oracle above still uses the real numbers; only what the model is shown is qualitative.
const sizeWord = tx => tx.amount > tx.typical * 6 ? 'far larger than any charge this cardholder has made before'
  : tx.amount > tx.typical * 2 ? 'noticeably larger than this cardholder usually spends' : 'in line with what this cardholder usually spends';
const timeWord = h => (h >= 0 && h < 5) ? 'in the middle of the night' : (h >= 5 && h < 12) ? 'in the morning' : (h >= 12 && h < 18) ? 'in the afternoon' : 'in the evening';

// One consistent sentence, built only from the structured fields above — the text a real fraud system's case
// notes would show, not a hand-written story per transaction.
export function describe(tx) {
  const place = tx.foreign ? `in ${tx.country}, a country this card has never been used in before` : `in ${tx.city}, the cardholder's home city`;
  const merch = tx.familiar ? `at ${tx.merchant}, a merchant this card has used many times before` : `at ${tx.merchant}, a merchant this card has never used before`;
  return `A ${tx.category} charge, ${sizeWord(tx)}, ${merch}, ${place}, ${timeWord(tx.hour)}.`;
}

export function toQuestion(tx) {
  return {
    tx: {
      type: 'choice', instructions: 'What should happen to this card transaction?',
      criteria: { approve: 'Nothing unusual here, let it go through', flag: 'A little unusual, let it through but have a human check it later', decline: 'Clear signs of fraud, block it now' },
    },
  };
}
export const toRequest = tx => ({ state: describe(tx), questions: toQuestion(tx) });

// 60 hand-authored transactions spanning the whole space: obviously fine, obviously bad, and the genuinely
// ambiguous middle the "flag" verdict exists for.
export const TRANSACTIONS = [
  // clearly approve: familiar merchant, home country, ordinary amount, ordinary hour
  { merchant: 'Corner Grocer', category: 'groceries', amount: 42, typical: 60, familiar: true, timesUsed: 38, foreign: false, city: 'Denver', hour: 9 },
  { merchant: 'Blue Bottle Coffee', category: 'coffee', amount: 6, typical: 60, familiar: true, timesUsed: 112, foreign: false, city: 'Denver', hour: 8 },
  { merchant: 'Shell Gas Station', category: 'gas', amount: 38, typical: 60, familiar: true, timesUsed: 20, foreign: false, city: 'Denver', hour: 17 },
  { merchant: 'Netflix', category: 'subscription', amount: 15, typical: 60, familiar: true, timesUsed: 24, foreign: false, city: 'Denver', hour: 3 },
  { merchant: 'CVS Pharmacy', category: 'pharmacy', amount: 22, typical: 60, familiar: true, timesUsed: 15, foreign: false, city: 'Denver', hour: 14 },
  { merchant: 'The Local Diner', category: 'restaurant', amount: 34, typical: 60, familiar: true, timesUsed: 9, foreign: false, city: 'Denver', hour: 19 },
  { merchant: 'Trader Joe’s', category: 'groceries', amount: 78, typical: 60, familiar: true, timesUsed: 40, foreign: false, city: 'Denver', hour: 11 },
  { merchant: 'Spotify', category: 'subscription', amount: 11, typical: 60, familiar: true, timesUsed: 30, foreign: false, city: 'Denver', hour: 2 },
  { merchant: 'City Transit', category: 'gas', amount: 25, typical: 60, familiar: true, timesUsed: 60, foreign: false, city: 'Denver', hour: 7 },
  { merchant: 'Home Depot', category: 'groceries', amount: 64, typical: 60, familiar: true, timesUsed: 6, foreign: false, city: 'Denver', hour: 15 },
  { merchant: 'Panera Bread', category: 'restaurant', amount: 18, typical: 60, familiar: true, timesUsed: 22, foreign: false, city: 'Denver', hour: 12 },
  { merchant: 'Walgreens', category: 'pharmacy', amount: 29, typical: 60, familiar: true, timesUsed: 18, foreign: false, city: 'Denver', hour: 16 },
  { merchant: 'Whole Foods', category: 'groceries', amount: 91, typical: 60, familiar: true, timesUsed: 27, foreign: false, city: 'Denver', hour: 18 },
  { merchant: 'Regal Cinemas', category: 'restaurant', amount: 32, typical: 60, familiar: true, timesUsed: 4, foreign: false, city: 'Denver', hour: 20 },
  { merchant: 'Gap', category: 'clothing', amount: 55, typical: 60, familiar: true, timesUsed: 5, foreign: false, city: 'Denver', hour: 13 },
  { merchant: 'Peet’s Coffee', category: 'coffee', amount: 5, typical: 60, familiar: true, timesUsed: 80, foreign: false, city: 'Denver', hour: 7 },
  { merchant: 'Amazon', category: 'clothing', amount: 48, typical: 60, familiar: true, timesUsed: 90, foreign: false, city: 'Denver', hour: 21 },
  { merchant: 'Sunoco', category: 'gas', amount: 44, typical: 60, familiar: true, timesUsed: 12, foreign: false, city: 'Denver', hour: 8 },
  { merchant: 'Safeway', category: 'groceries', amount: 66, typical: 60, familiar: true, timesUsed: 33, foreign: false, city: 'Denver', hour: 10 },
  { merchant: 'YMCA', category: 'subscription', amount: 40, typical: 60, familiar: true, timesUsed: 14, foreign: false, city: 'Denver', hour: 6 },

  // clearly flag: one or two risk signals, not a pile-up of all of them
  { merchant: 'Best Buy', category: 'electronics', amount: 340, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 15 },
  { merchant: 'Delta Air Lines', category: 'travel', amount: 480, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 11 },
  { merchant: 'Marriott', category: 'travel', amount: 260, typical: 60, familiar: true, timesUsed: 2, foreign: true, country: 'Canada', hour: 22 },
  { merchant: 'Zara', category: 'clothing', amount: 190, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 14 },
  { merchant: 'Steam', category: 'electronics', amount: 120, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 23 },
  { merchant: 'ATM – Main Street', category: 'cash withdrawal', amount: 100, typical: 60, familiar: true, timesUsed: 3, foreign: false, city: 'Denver', hour: 13 },
  { merchant: 'Corner Grocer', category: 'groceries', amount: 55, typical: 60, familiar: true, timesUsed: 38, foreign: false, city: 'Denver', hour: 2 },
  { merchant: 'Nordstrom', category: 'clothing', amount: 210, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 16 },
  { merchant: 'Enterprise Rent-A-Car', category: 'travel', amount: 230, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 9 },
  { merchant: 'GameStop', category: 'electronics', amount: 150, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 19 },
  { merchant: 'Local Pub', category: 'restaurant', amount: 48, typical: 60, familiar: true, timesUsed: 7, foreign: false, city: 'Denver', hour: 1 },
  { merchant: 'Duty Free', category: 'clothing', amount: 170, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Mexico', hour: 12 },
  { merchant: 'Best Western', category: 'travel', amount: 140, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 21 },
  { merchant: 'B&H Photo', category: 'electronics', amount: 260, typical: 60, familiar: false, timesUsed: 0, foreign: false, city: 'Denver', hour: 10 },
  { merchant: 'REI', category: 'clothing', amount: 175, typical: 60, familiar: true, timesUsed: 3, foreign: false, city: 'Denver', hour: 15 },

  // clearly decline: several risk signals stacking together
  { merchant: 'GoldMart Jewelry', category: 'jewelry', amount: 2400, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Nigeria', hour: 3 },
  { merchant: 'QuickCash Wire', category: 'wire transfer', amount: 3200, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Ukraine', hour: 2 },
  { merchant: 'GiftCardGalaxy', category: 'gift cards', amount: 900, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Vietnam', hour: 4 },
  { merchant: 'ATM – unknown', category: 'cash withdrawal', amount: 1500, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Romania', hour: 1 },
  { merchant: 'Diamond Direct', category: 'jewelry', amount: 5200, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Thailand', hour: 3 },
  { merchant: 'EuroWire Transfers', category: 'wire transfer', amount: 4100, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Latvia', hour: 4 },
  { merchant: 'GiftBox Online', category: 'gift cards', amount: 1200, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Indonesia', hour: 2 },
  { merchant: 'Rare Coins & Gold', category: 'jewelry', amount: 3800, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Nigeria', hour: 1 },
  { merchant: 'ATM – border town', category: 'cash withdrawal', amount: 2000, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Mexico', hour: 3 },
  { merchant: 'FastFunds Wire', category: 'wire transfer', amount: 2700, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Pakistan', hour: 2 },
  { merchant: 'GiftCard Emporium', category: 'gift cards', amount: 1600, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Philippines', hour: 4 },
  { merchant: 'Luxury Watch Direct', category: 'jewelry', amount: 6100, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Russia', hour: 2 },
  { merchant: 'TransGlobal Wire', category: 'wire transfer', amount: 5000, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Ghana', hour: 3 },
  { merchant: 'Best Buy', category: 'electronics', amount: 1800, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'China', hour: 4 },
  { merchant: 'ATM – airport', category: 'cash withdrawal', amount: 1100, typical: 60, familiar: false, timesUsed: 0, foreign: true, country: 'Turkey', hour: 3 },

  // more approve, to keep the class balance realistic (fraud is rare)
  { merchant: 'Blue Bottle Coffee', category: 'coffee', amount: 4, typical: 60, familiar: true, timesUsed: 113, foreign: false, city: 'Denver', hour: 8 },
  { merchant: 'Corner Grocer', category: 'groceries', amount: 51, typical: 60, familiar: true, timesUsed: 39, foreign: false, city: 'Denver', hour: 10 },
  { merchant: 'Shell Gas Station', category: 'gas', amount: 41, typical: 60, familiar: true, timesUsed: 21, foreign: false, city: 'Denver', hour: 17 },
  { merchant: 'The Local Diner', category: 'restaurant', amount: 29, typical: 60, familiar: true, timesUsed: 10, foreign: false, city: 'Denver', hour: 12 },
  { merchant: 'Netflix', category: 'subscription', amount: 15, typical: 60, familiar: true, timesUsed: 25, foreign: false, city: 'Denver', hour: 20 },
  { merchant: 'CVS Pharmacy', category: 'pharmacy', amount: 18, typical: 60, familiar: true, timesUsed: 16, foreign: false, city: 'Denver', hour: 9 },
  { merchant: 'Trader Joe’s', category: 'groceries', amount: 82, typical: 60, familiar: true, timesUsed: 41, foreign: false, city: 'Denver', hour: 18 },
  { merchant: 'Panera Bread', category: 'restaurant', amount: 21, typical: 60, familiar: true, timesUsed: 23, foreign: false, city: 'Denver', hour: 13 },
  { merchant: 'City Transit', category: 'gas', amount: 25, typical: 60, familiar: true, timesUsed: 61, foreign: false, city: 'Denver', hour: 7 },
  { merchant: 'Whole Foods', category: 'groceries', amount: 76, typical: 60, familiar: true, timesUsed: 28, foreign: false, city: 'Denver', hour: 19 },
];

if (TRANSACTIONS.length !== 60) throw new Error(`fraud/transactions.js: expected 60 transactions, got ${TRANSACTIONS.length}`);

export function scoreVerdict(tx, choice) {
  return { correct: choice === oracle(tx), oracle: oracle(tx) };
}
