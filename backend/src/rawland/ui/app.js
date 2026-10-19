// Raw Land prototype UI. County-wide list and counts come from /api/query (the account index); the map draws
// /api/tiles for the visible area only. A filter changes both. Moving the map changes the list only when
// "Limit to map area" is on.
const $ = (s) => document.querySelector(s);
const fmt$ = (v) => (v == null ? null : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const fmtPsf = (v) => (v == null ? null : `$${v.toFixed(2)}/sf`);
const meta = await (await fetch('/api/meta')).json();
const L_ = meta.labels;
const state = { filters: {}, sort: 'landPsf', dir: 'desc', after: null, rows: [], selected: null };

if (meta.manifest.synthetic) { $('#badge').textContent = 'Synthetic data'; $('#sub').textContent = 'Invented parcels and values for review · not BCAD data'; }
for (const z of meta.zoningCodes) $('select[name=zoning]').append(new Option(z, z));

const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([29.43, -98.52], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
const layer = L.geoJSON(null, {
  style: (f) => {
    const p = f.properties; const warn = /unavailable|conflict/i.test(p.zoningStatus) || p.conflict;
    const css = getComputedStyle(document.documentElement);
    return { color: warn ? css.getPropertyValue('--amber') : p.match ? css.getPropertyValue('--accent') : css.getPropertyValue('--muted'), weight: p.account === state.selected ? 3 : warn ? 1.5 : 1, dashArray: warn ? '4 3' : null, fillColor: p.match ? css.getPropertyValue('--accent') : css.getPropertyValue('--muted'), fillOpacity: p.match ? 0.35 : 0.08, opacity: p.match ? 0.9 : 0.35 };
  },
  onEachFeature: (f, l) => l.on('click', () => select(f.properties.account))
}).addTo(map);

const qs = (extra = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...state.filters, ...extra })) if (v !== '' && v != null && v !== false) p.set(k, v === true ? '1' : String(v));
  return p.toString();
};
const bboxStr = () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','); };

async function loadTiles() {
  const r = await (await fetch(`/api/tiles?${qs({ bbox: bboxStr() })}`)).json();
  layer.clearLayers();
  if (r.tooMany) return;
  layer.addData(r.features.map((f) => ({ type: 'Feature', geometry: f.outline, properties: f })));
}

async function loadList(append = false) {
  if (!append) { state.after = null; state.rows = []; }
  const p = qs({ sort: state.sort, dir: state.dir, n: 25, ...(state.after ? { after: JSON.stringify(state.after) } : {}), ...($('#limit').checked ? { bbox: bboxStr() } : {}) });
  const r = await (await fetch(`/api/query?${p}`)).json();
  state.rows.push(...r.rows); state.after = r.next;
  $('#count').textContent = `${r.count.toLocaleString('en-US')} ${r.count === 1 ? 'account' : 'accounts'}`;
  $('#scope').textContent = r.scope === 'map area' ? L_.inMapArea : 'county-wide · exact';
  const what = { landPsf: 'land $/sf', acres: 'acreage', market: 'market value', land: 'land value' }[state.sort];
  $('#unranked').textContent = r.unranked ? L_.unranked(r.unranked, what) : '';
  const list = $('#list');
  list.innerHTML = state.rows.length ? '' : '<div class="empty">No accounts match these filters.</div>';
  for (const a of state.rows) {
    const el = document.createElement('div'); el.className = 'row'; el.role = 'option'; el.setAttribute('aria-selected', a.account === state.selected);
    el.innerHTML = `<span class="id">${a.account}</span><span class="psf">${fmtPsf(a.landPsf) ?? '<span class="pill">Unavailable</span>'}</span><span class="meta">${a.acres == null ? 'Acres unavailable' : `${a.acres.toLocaleString('en-US')} ac`} · ${a.stateCode ?? '—'} · ${[...new Set(a.zoningBases)].join(', ') || a.zoningStatus}</span>`;
    el.onclick = () => select(a.account, true); list.append(el);
  }
  if (state.after) { const b = document.createElement('button'); b.className = 'more'; b.textContent = 'Show more'; b.onclick = () => loadList(true); list.append(b); }
}
// unranked label arrives as a function name in JSON; rebuild it client-side
L_.unranked = (n, what) => `${n.toLocaleString('en-US')} matching accounts have no ${what} and are not ranked`;
L_.inMapArea = 'in this map area';

const fact = (k, v, why = '', cls = '') => `<div class="fact"><div class="k">${k}</div><div class="v">${cls ? `<span class="pill ${cls}">${v}</span>` : v}</div>${why ? `<div class="why">${why}</div>` : ''}</div>`;
async function select(id, fly = false) {
  state.selected = id;
  const r = await fetch(`/api/account/${encodeURIComponent(id)}`); if (!r.ok) return;
  const a = await r.json();
  if (fly) map.fitBounds(L.geoJSON(a.outline).getBounds(), { maxZoom: 17, padding: [40, 40] });
  const z = a.zoning;
  const uninc = a.zoningStatus === L_.unincorporated;
  let zoningHtml, zWhy = '', zoneCls = /unavailable/i.test(a.zoningStatus) ? 'bad' : '';
  if (z?.conflict) {
    // conflicting records: each is listed on its own; their coverage shares overlap and are not summed
    zoningHtml = `<span class="pill warn">Conflicting zoning records</span><ul class="records">${z.districts.map((d) => `<li><b>${d.code}</b> · record covers ${Math.round(d.share * 100)}% of the parcel</li>`).join('')}</ul>`;
    zWhy = 'These records cover the same ground, so their percentages overlap and do not add up to 100%. The layer does not say which is current; confirm with the city.';
  } else if (z?.districts) {
    zoningHtml = z.districts.map((d) => `${d.code} ${Math.round(d.share * 100)}%`).join(' · ');
  } else {
    zoningHtml = uninc ? 'Unincorporated (no city zoning)' : a.zoningStatus;
    zWhy = z?.status === 'coverage unavailable' ? `Not computed: ${z.reason}. No partial result is shown.` : /PDF/.test(a.zoningStatus) ? 'This city publishes zoning as a PDF only; it is not integrated.' : '';
  }
  const limitsSrc = a.synthetic ? 'Synthetic boundary' : 'Bexar County "Cities" layer';
  const juris = uninc ? fact('Jurisdiction', 'Unincorporated', `${limitsSrc} classifies this area as JURIS = "Unincorporated". Bexar County does not zone unincorporated land. Boundary last updated: unknown (the county layer publishes no edit date).`) : '';
  const matched = !/not matched/.test(a.cityMatch);
  $('#detail').innerHTML = `<div class="dhead"><button class="close" aria-label="Close">✕</button>
    <h2>Account ${a.account}</h2><div class="sub">${a.synthetic ? 'Synthetic record' : 'Bexar Appraisal District account'} · state code ${a.stateCode ?? 'unavailable'}</div></div>
    ${fact('Market value', a.market == null ? 'Unavailable' : fmt$(a.market), L_.marketValue)}
    ${fact(L_.landValue, a.land == null ? 'Unavailable' : fmt$(a.land), a.land == null ? a.valueStatus : L_.provisional, a.land == null ? 'bad' : '')}
    ${fact(L_.landPsf, a.landPsf == null ? 'Unavailable' : fmtPsf(a.landPsf), a.landPsf == null ? (a.acres == null ? 'No reported land area.' : 'Land value unavailable.') : L_.provisional, a.landPsf == null ? 'bad' : 'prov')}
    ${fact('Appraised / assessed value', L_.appraisedAssessed)}
    ${fact('Land area', a.acres == null ? 'Unavailable' : `${a.acres.toLocaleString('en-US')} acres (reported)`)}
    ${juris}
    ${fact('Zoning', zoningHtml, zWhy, zoneCls)}
    ${fact('City parcel layer', a.cityMatch, matched ? 'Matched by account number only.' : '', /not matched|discrepancy/.test(a.cityMatch) ? 'warn' : '')}
    ${fact('Outline', L_.outline)}
    <div class="fact"><div class="why">Appraisal-district figures from the 2025 roll. They are not asking prices, sale prices or a current market estimate, and nothing here means the land is for sale.</div></div>`;
  $('#detail').scrollTop = 0; document.body.classList.add('detail-open');
  $('#detail').classList.add('open'); $('#detail .close').onclick = () => { $('#detail').classList.remove('open'); document.body.classList.remove('detail-open'); state.selected = null; layer.setStyle(layer.options.style); };
  layer.setStyle(layer.options.style);
  for (const el of document.querySelectorAll('.row')) el.setAttribute('aria-selected', el.querySelector('.id').textContent === id);
}

function readFilters() {
  const f = new FormData($('#filters'));
  state.filters = { minAcres: f.get('minAcres'), maxAcres: f.get('maxAcres'), minPsf: f.get('minPsf'), maxPsf: f.get('maxPsf'), zoning: f.get('zoning'), vacant: $('[data-vacant]').getAttribute('aria-pressed') === 'true' };
  [state.sort, state.dir] = String(f.get('sort')).split(':');
}
let t; const refresh = () => { clearTimeout(t); t = setTimeout(() => { readFilters(); loadList(); loadTiles(); }, 150); };
$('#filters').addEventListener('input', refresh);
$('[data-vacant]').onclick = (e) => { e.target.setAttribute('aria-pressed', e.target.getAttribute('aria-pressed') !== 'true'); refresh(); };
$('#limit').onchange = () => loadList();
map.on('moveend', () => { loadTiles(); if ($('#limit').checked) loadList(); });
for (const b of document.querySelectorAll('.tabs .chip')) b.onclick = () => { $('#side').dataset.tab = b.dataset.tab; for (const x of document.querySelectorAll('.tabs .chip')) x.setAttribute('aria-pressed', x === b); };
readFilters(); await Promise.all([loadList(), loadTiles()]);
window.__rawland = { state, map, select };
