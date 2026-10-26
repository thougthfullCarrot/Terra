// news-view.js — draws the news section. The rules live in news.js.
//
// Commercial real estate headlines by city, from news.json (Google News
// search RSS, refreshed with the site). Each headline links out to the
// publisher; the page shows only the headline, source and date.
import { filterHeadlines, newsDate, readNewsHash, topicCounts, writeNewsHash } from './news.js';
import { stateBox } from './labels.js';
import { DEAL_MARKETS, dealView, writeDealHash } from './deal-view.js';

const $ = (id) => document.getElementById(id);

let file = null;
let loading = null;
let state = null;
let bound = false;

export function startNews() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  $('n-city').addEventListener('change', (e) => update({ city: e.target.value }));
  const dealCity = $('n-deal-city');
  dealCity.append(new Option('All markets', ''), ...DEAL_MARKETS.map((m) => new Option(m, m)));
  dealCity.addEventListener('change', () => {
    history.replaceState(null, '', `${location.pathname}${location.search}${writeDealHash(dealCity.value)}`);
    show();
  });
  show();
}

async function load() {
  const response = await fetch('news.json', { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`news.json returned ${response.status}`);
  return response.json();
}

function update(change) {
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${location.search}${writeNewsHash(state)}`);
  render();
}

async function show() {
  const open = readNewsHash(location.hash, null).open;
  $('news-view').hidden = !open;
  if (!open) return;
  const deal = readNewsHash(location.hash, null).view === 'deal';
  drawViews(deal);
  if (deal) {
    showDeal();
    return;
  }
  if (!file) {
    message('Loading headlines…', 'loading');
    loading ??= load();
    try {
      const data = await loading;
      if (!data?.cities?.some((c) => c.headlines?.length)) {
        loading = null;
        message('Headlines are being gathered. Check back in a few minutes.');
        return;
      }
      file = data;
    } catch (error) {
      loading = null;
      message(`Couldn't load headlines. ${error instanceof Error ? error.message : ''}`.trim(), true);
      return;
    }
  }
  state = readNewsHash(location.hash, file);
  const city = $('n-city');
  city.replaceChildren(new Option('All cities', ''), ...file.cities.map((c) => new Option(c.city, c.city)));
  render();
}

/** Headlines and Deal of the week: two sections of News, each with its own controls. */
function drawViews(deal) {
  $('n-tab-headlines').href = writeNewsHash({ city: state?.city ?? '' });
  $('n-tab-deal').href = writeDealHash(DEAL_MARKETS.includes(state?.city) ? state.city : '');
  if (deal) $('n-tab-deal').setAttribute('aria-current', 'page');
  else $('n-tab-deal').removeAttribute('aria-current');
  if (deal) $('n-tab-headlines').removeAttribute('aria-current');
  else $('n-tab-headlines').setAttribute('aria-current', 'page');
  for (const id of ['n-headline-filters', 'n-topics-group', 'n-summary', 'n-list', 'n-sources']) $(id).hidden = deal;
  for (const id of ['n-deal-filters', 'n-deal-blurb', 'n-deal', 'n-deal-sources']) $(id).hidden = !deal;
}

let dealRenders = 0;
function showDeal() {
  const raw = readNewsHash(location.hash, null).dealCity;
  const city = DEAL_MARKETS.includes(raw) ? raw : '';
  $('n-deal-city').value = city;
  const body = $('n-deal');
  body.replaceChildren(stateBox('Loading…', 'loading'));
  $('n-deal-sources').replaceChildren();
  const gen = ++dealRenders;
  const live = () => gen === dealRenders && readNewsHash(location.hash, null).view === 'deal';
  dealView(body, $('n-deal-sources'), city, live).catch(
    (error) => live() && body.replaceChildren(stateBox(`Couldn't load the deal of the week. ${error instanceof Error ? error.message : ''}`.trim(), 'error', { retry: true }))
  );
}

function render() {
  $('n-city').value = state.city;

  const counts = topicCounts(file, state.city);
  const chips = $('n-topics');
  chips.replaceChildren(
    chip('All', '', filterHeadlines(file, { city: state.city }).length),
    ...file.topics.map((topic) => chip(topic, topic, counts.get(topic) ?? 0))
  );

  const headlines = filterHeadlines(file, state);
  $('n-count').textContent = `${headlines.length} ${headlines.length === 1 ? 'headline' : 'headlines'}${
    state.city ? ` in ${state.city}` : ' across Texas'
  }${state.topic ? ` · ${state.topic}` : ''}`;

  const list = $('n-list');
  if (!headlines.length) {
    message(state.topic ? `No ${state.topic.toLowerCase()} headlines${state.city ? ` for ${state.city}` : ''} this month.` : 'No headlines this month.');
    return;
  }
  const now = new Date();
  list.replaceChildren(...headlines.map((h, i) => item(h, i, now)));

  const updated = new Date(file.generatedAt);
  $('n-sources').replaceChildren(
    el(
      'p',
      '',
      `Headlines from ${file.source ?? 'Google News'} searches for each city, ${
        Number.isNaN(updated.getTime()) ? '' : `updated ${updated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      }. Each one opens on the publisher's site; Terra doesn't copy articles.`
    )
  );
}

function chip(label, topic, count) {
  const button = el('button', `chip${count ? '' : ' empty'}`, label);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(state.topic === topic));
  button.append(el('span', 'chip-count', String(count)));
  button.addEventListener('click', () => update({ topic }));
  return button;
}

function item(headline, index, now) {
  const card = el('article', 'card news-item');
  card.style.setProperty('--i', String(Math.min(index, 20)));
  const meta = el('p', 'news-meta');
  meta.append(el('span', 'news-source', headline.source || 'News'));
  const when = newsDate(headline.publishedAt, now);
  if (when) {
    const time = el('time', '', when);
    time.dateTime = headline.publishedAt;
    meta.append(time);
  }
  const title = el('h3', 'news-title');
  const link = el('a', '', headline.title);
  link.href = headline.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  title.append(link);
  const tags = el('ul', 'chips');
  if (!state.city) for (const city of headline.cities) tags.append(el('li', 'kind', city));
  for (const topic of headline.topics ?? []) tags.append(el('li', '', topic));
  card.append(meta, title);
  if (tags.childElementCount) card.append(tags);
  return card;
}

function message(text, kind = 'empty') {
  $('n-list').replaceChildren(stateBox(text, kind, { retry: kind === true }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
