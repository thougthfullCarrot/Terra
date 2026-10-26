// deal-view.js — Deal of the week, shown as its own section under News.
//
// One real Texas sale from the week's news, walked through step by step. The
// rules (which deal a market shows, the teaching estimates) live in
// property.js; the file is site/property/deal.json (export-property.ts --only deal).
// It used to be a Property tab tool; old #property&tool=deal links land here
// through retired.js.
import { analyzeDeal } from './deal.js';
import { CENTERS } from './devmap.js';
import { DEAL_LOAN, DEAL_TYPE_LABELS, dealSteps, money, pastDeals, pickDeal } from './property.js';

/** The markets the deal's selector offers. */
export const DEAL_MARKETS = Object.keys(CENTERS);

/** #news&view=deal&city=Houston: the deal section on a market. */
export function writeDealHash(city) {
  return `#news&view=deal${city ? `&city=${encodeURIComponent(city)}` : ''}`;
}

let file = null;
let loading = null;

function loadDeal() {
  if (file) return Promise.resolve(file);
  loading ??= fetch('property/deal.json', { cache: 'no-cache' })
    .then((response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`deal.json returned ${response.status}`);
      return response.json();
    })
    .then((data) => (file = data))
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

export async function dealView(body, sources, city, live = () => true) {
  const file = await loadDeal();
  // A newer market or tool was picked while the file loaded; that render owns the page now.
  if (!live()) return;
  const pick = file ? pickDeal(file, city) : { status: 'pending', deal: null };
  if (!pick.deal) {
    const box = el('div', 'state deal-none');
    if (pick.status === 'none') {
      box.append(el('p', '', `No verified ${city} sale with a reported price was in the news this week, and Terra has no earlier ${city} pick to show. Terra won't swap in another market's deal.`));
      const all = el('a', 'link', "See this week's Texas deal (All markets) →");
      all.href = writeDealHash('');
      box.append(all);
    } else {
      box.textContent = "This week's deal is being picked. Check back after the next update.";
    }
    body.replaceChildren(box);
    sources.replaceChildren(dealSourceNote(file));
    return;
  }
  const deal = pick.deal;
  const steps = dealSteps(deal, file, analyzeDeal);
  const card = el('article', 'card deal-card');
  const top = el('p', 'news-meta');
  card.dataset.dealUrl = deal.url;
  card.dataset.dealStatus = pick.status;
  top.append(el('span', '', `${city || 'Texas'} · week of ${longDate(deal.week)}`), el('span', 'news-source', deal.source));
  const title = el('h3', 'deal-title');
  title.append(link(deal.title, deal.url));
  const tags = el('ul', 'chips');
  for (const t of [deal.place, DEAL_TYPE_LABELS[deal.type], deal.curated ? 'Figures checked by Terra' : '']) if (t) tags.append(el('li', '', t));
  card.append(top);
  if (pick.status === 'older')
    card.append(
      el(
        'p',
        'deal-older-note',
        `No verified ${city} sale with a reported price was in the news the week of ${longDate(pick.week)}. This is the most recent ${city} deal Terra picked, from the week of ${longDate(deal.week)}${deal.publishedAt ? ` (reported ${longDate(deal.publishedAt)})` : ''}.`
      )
    );
  card.append(title, tags);

  // What the news reported, kept apart from Terra's teaching estimates below.
  const reported = el('dl', 'deal-reported');
  for (const [label, value] of [
    ['Price', money(deal.price)],
    ['Where', deal.place],
    ['Size', deal.squareFeet ? `${Math.round(deal.squareFeet).toLocaleString('en-US')} sq ft` : deal.units ? `${deal.units} units` : null],
    ['Reported', deal.publishedAt ? `${longDate(deal.publishedAt)}${deal.source ? `, ${deal.source}` : ''}` : deal.source || null],
    ['Cap rate', deal.capRate != null ? `${Number(deal.capRate).toFixed(2)}%` : null],
    ['Income (NOI)', deal.noi != null ? money(deal.noi) : null]
  ]) {
    if (value) reported.append(el('dt', '', label), el('dd', '', value));
  }
  const facts = el('section', 'deal-facts');
  facts.append(el('h4', 'deal-step-title', 'Reported in the news'), reported);
  if (!steps.capKnown) facts.append(el('p', 'calc-note', 'The income, loan and returns below are Terra\'s teaching estimates from typical cap rates and today\'s rates. The buyer\'s real income and financing weren\'t disclosed.'));
  card.append(facts);

  const list = el('ol', 'deal-steps');
  const step = (heading, ...lines) => {
    const li = el('li');
    li.append(el('h4', 'deal-step-title', heading), ...lines.filter(Boolean).map((l) => (typeof l === 'string' ? el('p', '', l) : l)));
    list.append(li);
  };
  const size = [
    steps.perSqft ? `${money(steps.perSqft)} per square foot` : '',
    steps.squareFeet ? `on about ${Math.round(steps.squareFeet).toLocaleString('en-US')} sq ft` : '',
    steps.perUnit ? `${money(steps.perUnit)} per apartment` : ''
  ]
    .filter(Boolean)
    .join(' ');
  step(
    `The price: ${money(steps.price)}`,
    size ? `That works out to ${size}. Price per foot (or per unit) is how buyers compare buildings of different sizes.` : 'The headline gives the price but not the size; the seller and broker usually announce it in the full story.'
  );
  if (steps.cap != null) {
    step(
      `${steps.capKnown ? 'The income' : 'The income it implies (estimate)'}: about ${money(steps.noi)} a year`,
      steps.capKnown
        ? `The deal traded at a ${steps.cap.toFixed(2)}% cap rate, so the building's net operating income (rent minus operating costs, before the loan) is about ${money(steps.noi)} a year.`
        : `Texas doesn't make sale prices or rents public, so the income is an estimate. ${DEAL_TYPE_LABELS[deal.type]} in Texas has been trading around a ${steps.band.low}–${steps.band.high}% cap rate. At ${steps.cap}%, the buyer expects about ${money(steps.noi)} a year of net operating income. Cap rate = income ÷ price.`
    );
    const loan = steps.loan;
    step(
      `A typical loan (estimate): ${money(loan.amount)} at about ${steps.rate.toFixed(2)}%`,
      `A typical lender would lend around ${100 - DEAL_LOAN.down}% of the price. At ${file.treasury ? `the 10-year Treasury (${file.treasury.value.toFixed(2)}%) plus ${DEAL_LOAN.spread} points` : 'today\'s rates'}, over ${DEAL_LOAN.years} years, the payments come to ${money(loan.debtService)} a year. The income covers that ${loan.dscr ? loan.dscr.toFixed(2) : '—'} times (lenders want at least 1.25).`
    );
    const verdict =
      loan.leverage === 'positive'
        ? `Positive leverage: the property earns ${steps.cap.toFixed(2)}% while the debt costs ${loan.constant.toFixed(2)}% a year, so every dollar borrowed raises the buyer's return.`
        : loan.leverage === 'negative'
          ? `Negative leverage: the debt costs ${loan.constant.toFixed(2)}% a year but the property only earns ${steps.cap.toFixed(2)}%, so borrowing lowers the buyer's return today. Buyers accept that when they expect rents or value to grow, plan to fix up the building, or pay mostly cash.`
          : `Neutral leverage: the debt costs about what the property earns (${loan.constant.toFixed(2)}% vs ${steps.cap.toFixed(2)}%), so the return comes down to growth.`;
    step(
      `Year-one cash return (estimate): ${loan.cashOnCash == null ? '—' : `${loan.cashOnCash.toFixed(1)}%`}`,
      `The buyer puts in about ${money(loan.cashInvested)} of equity and keeps ${money(loan.cashFlow)} after the loan payments.`,
      verdict
    );
  } else {
    step('The income', 'This is a land deal: land earns no rent until something is built, so buyers price it per acre or per buildable square foot instead of by a cap rate.');
  }
  if (deal.why) step('Why it made sense', deal.why);
  card.append(list);

  card.append(
    el(
      'p',
      'calc-note',
      deal.curated
        ? 'Price and income from public reporting on this sale.'
        : 'Price from the headline; income and loan figures are Terra\'s teaching estimates from typical market cap rates, not the deal\'s actual numbers.'
    )
  );

  const nodes = [card];
  // Other markets' sales only on All markets, labeled as such; a market page stays local.
  if (!city && file.alsoThisWeek?.length) {
    const more = el('section', 'card');
    more.append(el('h3', 'group-title', 'Other Texas sales in the news this week'));
    const ul = el('ul', 'owner-list');
    for (const d of file.alsoThisWeek) {
      const li = el('li');
      li.append(link(d.title, d.url), el('span', 'radar-line muted', `${money(d.price)} · ${d.source}`));
      ul.append(li);
    }
    more.append(ul);
    nodes.push(more);
  }
  const earlier = pastDeals(file, city, deal);
  if (earlier.length) {
    const past = el('section', 'card');
    past.append(el('h3', 'group-title', city ? `Earlier ${city} deals of the week` : 'Past deals of the week'));
    const ul = el('ul', 'owner-list');
    for (const d of earlier) {
      const li = el('li');
      li.append(link(d.title, d.url), el('span', 'radar-line muted', `Week of ${longDate(d.week)} · ${money(d.price)}${city ? '' : ` · ${d.place}`}`));
      ul.append(li);
    }
    past.append(ul);
    nodes.push(past);
  }
  body.replaceChildren(...nodes);
  sources.replaceChildren(dealSourceNote(file));
}

function dealSourceNote(file) {
  return note(
    `Picked from Google News headlines that report a Texas sale with a price: the biggest of the week statewide, and the biggest in each market by where the property is (not where the buyer or the paper is). The 10-year Treasury is from FRED.${file?.generatedAt ? ` Updated ${longDate(file.generatedAt)}.` : ''}`
  );
}

// ---------------------------------------------------------------- helpers

function note(text) {
  return el('p', '', text);
}

function longDate(iso) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}

function link(text, href) {
  const a = el('a', 'link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
