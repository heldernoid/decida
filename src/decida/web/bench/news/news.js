// News trading: a wire headline and a social-media reaction arrive together for a fictional company, one event at
// a time, needing a buy/hold/sell call before the next lands — reacting to breaking news faster than anyone else
// is the entire value of a low-latency model here. Companies are fictional on purpose, so nothing here reads as
// real trading advice about a real stock. The "correct" call is the conventional, textbook-expected direction for
// that category of news (earnings beat -> buy, product recall -> sell, and so on) — a simplification of real
// markets, not a claim that this is how any real stock would actually move.
// Pure logic, no DOM: runs in the browser and under node.

export const DIRECTIONS = ['buy', 'hold', 'sell'];

// 50 hand-written events across 10 fictional companies. Each has its own wire headline and social reaction,
// written separately, plus the conventional direction for its category.
export const EVENTS = [
  // --- buy (20) ---
  { company: 'Nova Dynamics', ticker: 'NVDY', category: 'earnings beat', wire: 'Nova Dynamics reports quarterly revenue 22% above analyst estimates, driven by satellite launch contracts.', social: '@spacewatcher: NVDY just blew past every estimate on the street, launch backlog is insane right now', direction: 'buy' },
  { company: 'BrightLeaf Foods', ticker: 'BLFD', category: 'guidance raised', wire: 'BrightLeaf Foods raises full-year guidance, citing stronger than expected demand for its plant-based line.', social: '@foodindustrynews: BLFD just upped guidance twice this year, plant-based line is clearly working', direction: 'buy' },
  { company: 'Cascade Biotech', ticker: 'CSDB', category: 'regulatory approval', wire: 'Cascade Biotech receives regulatory approval for its lead drug candidate, clearing the way for commercial launch.', social: '@biotechalpha: approval finally came through for Cascade, this has been the whole thesis for 2 years', direction: 'buy' },
  { company: 'Solaris Energy', ticker: 'SLRE', category: 'merger target', wire: 'Solaris Energy to be acquired by a larger utility at a 35% premium to its closing price.', social: '@energydesk: 35% premium buyout for SLRE, that’s a huge number for a deal this size', direction: 'buy' },
  { company: 'Ironclad Financial', ticker: 'IRNF', category: 'analyst upgrade', wire: 'A major bank upgrades Ironclad Financial to "buy", citing improving net interest margins.', social: '@bankingbeat: another upgrade for IRNF this morning, margins finally turning the corner', direction: 'buy' },
  { company: 'Helix Semiconductor', ticker: 'HLXS', category: 'product launch success', wire: 'Helix Semiconductor’s new chip line sells out its initial production run within days of launch.', social: '@chipwatch: HLXS new chips are sold out everywhere, demand way ahead of what they planned for', direction: 'buy' },
  { company: 'Vertex Retail Group', ticker: 'VRTX', category: 'strong sales', wire: 'Vertex Retail Group reports its strongest holiday sales quarter in company history.', social: '@retailtracker: VRTX same-store sales numbers this quarter are the best I’ve seen from them ever', direction: 'buy' },
  { company: 'Pinnacle Motors', ticker: 'PNCM', category: 'buyback announced', wire: 'Pinnacle Motors announces a $2 billion share buyback program, its largest to date.', social: '@autosector: PNCM putting real money behind the buyback this time, biggest program they’ve run', direction: 'buy' },
  { company: 'Meridian Media', ticker: 'MRDM', category: 'dividend raised', wire: 'Meridian Media raises its quarterly dividend by 18%, its largest increase in five years.', social: '@mediamoney: MRDM dividend hike is a strong signal from management on where cash flow is headed', direction: 'buy' },
  { company: 'Quantum Steel Corp', ticker: 'QSTC', category: 'insider buying', wire: 'Quantum Steel’s CEO purchases $4 million of company stock on the open market.', social: '@industrialwatch: CEO buying that much stock with his own money is a real vote of confidence for QSTC', direction: 'buy' },
  { company: 'Nova Dynamics', ticker: 'NVDY', category: 'ceo hire well regarded', wire: 'Nova Dynamics names a veteran aerospace executive as its new CEO, effective immediately.', social: '@spacewatcher: great hire for NVDY, she ran launch operations at a much bigger company before this', direction: 'buy' },
  { company: 'Cascade Biotech', ticker: 'CSDB', category: 'lawsuit settled favorably', wire: 'Cascade Biotech settles its patent dispute on favorable terms, removing a long-running overhang.', social: '@biotechalpha: that lawsuit has been hanging over CSDB for two years, glad it’s finally resolved well', direction: 'buy' },
  { company: 'Ironclad Financial', ticker: 'IRNF', category: 'credit upgrade', wire: 'A ratings agency upgrades Ironclad Financial’s credit rating, citing a stronger balance sheet.', social: '@bankingbeat: credit upgrade for IRNF means cheaper borrowing costs going forward', direction: 'buy' },
  { company: 'BrightLeaf Foods', ticker: 'BLFD', category: 'product launch success', wire: 'BrightLeaf Foods’ new snack line becomes the top seller in its category within its first month.', social: '@foodindustrynews: BLFD new snacks are flying off shelves, category leader already', direction: 'buy' },
  { company: 'Solaris Energy', ticker: 'SLRE', category: 'earnings beat', wire: 'Solaris Energy posts earnings well ahead of expectations as installation volumes surge.', social: '@energydesk: SLRE numbers came in way above what anyone was modeling, installs are accelerating', direction: 'buy' },
  { company: 'Helix Semiconductor', ticker: 'HLXS', category: 'guidance raised', wire: 'Helix Semiconductor raises next-quarter guidance on stronger than expected order volumes.', social: '@chipwatch: HLXS just raised guidance again, order book keeps getting bigger', direction: 'buy' },
  { company: 'Vertex Retail Group', ticker: 'VRTX', category: 'analyst upgrade', wire: 'Two analysts upgrade Vertex Retail Group following its strong same-store sales report.', social: '@retailtracker: double upgrade day for VRTX, street is finally catching up to the sales trend', direction: 'buy' },
  { company: 'Pinnacle Motors', ticker: 'PNCM', category: 'regulatory approval', wire: 'Pinnacle Motors receives regulatory approval to sell its new electric model in a major new market.', social: '@autosector: big market just opened up for PNCM’s EV lineup', direction: 'buy' },
  { company: 'Meridian Media', ticker: 'MRDM', category: 'merger target', wire: 'Meridian Media confirms takeover talks with a larger streaming company at a premium valuation.', social: '@mediamoney: MRDM takeover rumors just got confirmed, premium price being discussed', direction: 'buy' },
  { company: 'Quantum Steel Corp', ticker: 'QSTC', category: 'strong sales', wire: 'Quantum Steel reports record order volumes as construction demand rebounds.', social: '@industrialwatch: QSTC order book is the biggest it’s been in years', direction: 'buy' },

  // --- sell (20) ---
  { company: 'Nova Dynamics', ticker: 'NVDY', category: 'earnings miss', wire: 'Nova Dynamics reports quarterly revenue well below analyst estimates, citing launch delays.', social: '@spacewatcher: NVDY missed badly this quarter, delays are really starting to bite', direction: 'sell' },
  { company: 'BrightLeaf Foods', ticker: 'BLFD', category: 'product recall', wire: 'BrightLeaf Foods issues a nationwide recall of its packaged salad line over contamination concerns.', social: '@foodindustrynews: BLFD recall is spreading to more states, this is a bad one', direction: 'sell' },
  { company: 'Cascade Biotech', ticker: 'CSDB', category: 'regulatory investigation', wire: 'Regulators open an investigation into Cascade Biotech’s clinical trial data practices.', social: '@biotechalpha: an investigation into trial data is about as bad as headlines get for a biotech', direction: 'sell' },
  { company: 'Solaris Energy', ticker: 'SLRE', category: 'guidance cut', wire: 'Solaris Energy cuts full-year guidance, citing supply chain delays for key components.', social: '@energydesk: SLRE just slashed guidance, supply chain problems worse than they let on', direction: 'sell' },
  { company: 'Ironclad Financial', ticker: 'IRNF', category: 'analyst downgrade', wire: 'A major bank downgrades Ironclad Financial to "sell", citing rising loan defaults.', social: '@bankingbeat: downgrade for IRNF this morning, default rates climbing faster than expected', direction: 'sell' },
  { company: 'Helix Semiconductor', ticker: 'HLXS', category: 'data breach', wire: 'Helix Semiconductor discloses a data breach affecting customer order records.', social: '@chipwatch: HLXS breach disclosure just dropped, details still unclear but not a good look', direction: 'sell' },
  { company: 'Vertex Retail Group', ticker: 'VRTX', category: 'weak sales', wire: 'Vertex Retail Group reports its weakest holiday sales quarter in a decade.', social: '@retailtracker: VRTX same-store sales are the worst I’ve tracked from them in years', direction: 'sell' },
  { company: 'Pinnacle Motors', ticker: 'PNCM', category: 'dividend cut', wire: 'Pinnacle Motors cuts its dividend in half to preserve cash amid slowing sales.', social: '@autosector: dividend cut for PNCM, that’s never a sign of a company feeling confident', direction: 'sell' },
  { company: 'Meridian Media', ticker: 'MRDM', category: 'insider selling', wire: 'Several Meridian Media executives sell large blocks of company stock this week.', social: '@mediamoney: a lot of insider selling at MRDM all at once, worth watching closely', direction: 'sell' },
  { company: 'Quantum Steel Corp', ticker: 'QSTC', category: 'lawsuit filed', wire: 'A major customer files a breach of contract lawsuit against Quantum Steel Corp.', social: '@industrialwatch: this lawsuit against QSTC names a lot of money, could drag on for a while', direction: 'sell' },
  { company: 'Nova Dynamics', ticker: 'NVDY', category: 'ceo scandal', wire: 'Nova Dynamics’ CEO resigns amid an internal investigation into expense reporting.', social: '@spacewatcher: CEO resigning under investigation is exactly the kind of headline NVDY didn’t need', direction: 'sell' },
  { company: 'Cascade Biotech', ticker: 'CSDB', category: 'credit downgrade', wire: 'A ratings agency downgrades Cascade Biotech’s debt, citing a weaker cash position.', social: '@biotechalpha: credit downgrade for CSDB means borrowing just got a lot more expensive', direction: 'sell' },
  { company: 'Ironclad Financial', ticker: 'IRNF', category: 'regulatory investigation', wire: 'Regulators open an inquiry into Ironclad Financial’s lending practices.', social: '@bankingbeat: an inquiry into lending practices is a real overhang for IRNF now', direction: 'sell' },
  { company: 'BrightLeaf Foods', ticker: 'BLFD', category: 'earnings miss', wire: 'BrightLeaf Foods misses earnings estimates as input costs rise faster than pricing.', social: '@foodindustrynews: BLFD margins getting squeezed hard, costs outrunning price increases', direction: 'sell' },
  { company: 'Solaris Energy', ticker: 'SLRE', category: 'analyst downgrade', wire: 'An analyst downgrades Solaris Energy, citing increased competition in the solar market.', social: '@energydesk: downgrade for SLRE today, competition from new entrants is the concern', direction: 'sell' },
  { company: 'Helix Semiconductor', ticker: 'HLXS', category: 'guidance cut', wire: 'Helix Semiconductor cuts guidance as a major customer delays a large order.', social: '@chipwatch: HLXS just cut guidance, sounds like one big customer pulled back hard', direction: 'sell' },
  { company: 'Vertex Retail Group', ticker: 'VRTX', category: 'lawsuit filed', wire: 'A group of former employees files a class action lawsuit against Vertex Retail Group.', social: '@retailtracker: class action against VRTX just got filed, could be a costly one', direction: 'sell' },
  { company: 'Pinnacle Motors', ticker: 'PNCM', category: 'product recall', wire: 'Pinnacle Motors recalls 200,000 vehicles over a braking system defect.', social: '@autosector: 200k vehicle recall for PNCM, braking issues are about as serious as it gets', direction: 'sell' },
  { company: 'Meridian Media', ticker: 'MRDM', category: 'weak sales', wire: 'Meridian Media reports subscriber losses for the second consecutive quarter.', social: '@mediamoney: MRDM losing subscribers again, trend is not going the right way', direction: 'sell' },
  { company: 'Quantum Steel Corp', ticker: 'QSTC', category: 'guidance cut', wire: 'Quantum Steel Corp cuts guidance as construction demand slows more than expected.', social: '@industrialwatch: QSTC guidance cut today, demand rolling over faster than the street thought', direction: 'sell' },

  // --- hold (10): genuinely mixed or routine, no clear directional signal ---
  { company: 'Nova Dynamics', ticker: 'NVDY', category: 'earnings inline', wire: 'Nova Dynamics reports quarterly results in line with analyst estimates.', social: '@spacewatcher: pretty boring quarter for NVDY, numbers matched estimates almost exactly', direction: 'hold' },
  { company: 'BrightLeaf Foods', ticker: 'BLFD', category: 'analyst maintain', wire: 'An analyst maintains a neutral rating on BrightLeaf Foods following its latest earnings call.', social: '@foodindustrynews: nothing new from the analyst note on BLFD today, rating unchanged', direction: 'hold' },
  { company: 'Cascade Biotech', ticker: 'CSDB', category: 'routine regulatory filing', wire: 'Cascade Biotech files a routine quarterly update with regulators, as required.', social: '@biotechalpha: just the standard quarterly filing from CSDB, nothing notable in it', direction: 'hold' },
  { company: 'Solaris Energy', ticker: 'SLRE', category: 'minor management change', wire: 'Solaris Energy announces a new head of investor relations.', social: '@energydesk: minor personnel change at SLRE, investor relations lead, not an operational role', direction: 'hold' },
  { company: 'Ironclad Financial', ticker: 'IRNF', category: 'mixed guidance', wire: 'Ironclad Financial reaffirms full-year guidance but flags uncertainty in the back half.', social: '@bankingbeat: IRNF keeping guidance the same but hedging on the second half, mixed signal', direction: 'hold' },
  { company: 'Helix Semiconductor', ticker: 'HLXS', category: 'earnings inline', wire: 'Helix Semiconductor posts quarterly revenue matching consensus estimates.', social: '@chipwatch: HLXS numbers landed right on consensus, no real surprise either way', direction: 'hold' },
  { company: 'Vertex Retail Group', ticker: 'VRTX', category: 'routine regulatory filing', wire: 'Vertex Retail Group files its annual report with no notable changes from prior guidance.', social: '@retailtracker: annual filing from VRTX is pretty much as expected, nothing new', direction: 'hold' },
  { company: 'Pinnacle Motors', ticker: 'PNCM', category: 'analyst maintain', wire: 'An analyst reiterates a hold rating on Pinnacle Motors after a routine site visit.', social: '@autosector: analyst visit to PNCM plant didn’t change anything, rating held steady', direction: 'hold' },
  { company: 'Meridian Media', ticker: 'MRDM', category: 'mixed guidance', wire: 'Meridian Media reports growth in one division offset by declines in another.', social: '@mediamoney: mixed bag for MRDM this quarter, one segment up, one down, nets out flat', direction: 'hold' },
  { company: 'Quantum Steel Corp', ticker: 'QSTC', category: 'minor management change', wire: 'Quantum Steel Corp announces a new regional sales director for its eastern division.', social: '@industrialwatch: routine regional appointment at QSTC, not a headline-level change', direction: 'hold' },
];

if (EVENTS.length !== 50) throw new Error(`news/news.js: expected 50 events, got ${EVENTS.length}`);

export function describe(ev) {
  return `${ev.wire}\n\nSocial media reaction: "${ev.social}"`;
}

export function toQuestion() {
  return {
    call: {
      type: 'choice', instructions: 'Given this news, what should happen to the position in this stock?',
      criteria: { buy: 'The news is good for the company; buy or add to the position', hold: 'The news does not clearly point either way; hold', sell: 'The news is bad for the company; sell or reduce the position' },
    },
  };
}
export const toRequest = ev => ({ state: describe(ev), questions: toQuestion() });
export const oracle = ev => ev.direction;
