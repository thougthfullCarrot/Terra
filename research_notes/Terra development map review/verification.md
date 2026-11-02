# Verification pass — dev map review findings at current HEAD

Checked against `/home/user/Terra` at HEAD `8897046`. Reviewers read a checkout ~80 commits
behind; current sizes: `site/devmap.js` 1599 lines, `site/markets-view.js` 1165,
`backend/test/browser/devmap-check.mjs` 723.

**Scope.** This pass covers `user-flows.md`, `performance-and-tests.md` and
`accessibility.md` only. `code-structure.md` has been re-verified and rewritten against this
same HEAD by its own author and is current; its findings — the tab-away `disposeMap()` leak,
the two-Leaflet-integration set, the `.d.ts` gap, the function-size findings and the dead-code
inventory — are not restated here, to avoid a second set of line numbers for the same code.

**Deletions.** Commit `d3b019e` ("Retire Property, Career and five Market tools; move Deal of
the week to News") removed both `site/property-view.js` and `site/career-view.js`. Every
finding in the notes verified here that cites either file is therefore **MOOT**; in these
three notes that is `user-flows.md`'s opening correction about the two files not embedding the
map and about `property-view.js`'s own `disposeMap` (which, for the record, was an
independently written module-private function, not a shadowed import), and its citation of
`property-view.js:757-764`. Nothing in `performance-and-tests.md` or `accessibility.md`
depends on either file.

## Headline findings

### 1. `api.show()` ending in an unconditional `fit()` — CHANGED
`show()` now takes an opt-out, `site/devmap.js:1241-1253`:
```js
    show(ids, { keepView = false } = {}) {
      …
      if (keepView && fitted) draw();
      else fit();
    },
```
But the only call site passes `keepView` for the time-lapse alone —
`site/devmap.js:488` `map?.show(ids, { keepView: Boolean(until) });`. So for every ordinary
filter change, keystroke, legend click, chart click, sort or hiring toggle, `until` is `''`
and the refit still happens. The mechanism the reviewers asked for exists (added by
`758ffc6`, the time-lapse commit, not as a UX fix); the defect is unfixed for user-driven
filter changes. `fit()` itself still unconditionally `fitBounds`/`setView`
(`site/devmap.js:1203-1208`), and the `fitted` flag still only suppresses a second
ResizeObserver fit (`:1216`).

### 2. Metro switch with a stale filter → zero results, all pills "All" — CONFIRMED
Order is unchanged. `site/devmap.js:165-168` still resets only `place`:
```js
  if (filtersCity !== city) {
    filters = { ...filters, place: '' };
    filtersCity = city;
  }
```
`apply()` computes `shown` first (`site/devmap.js:389`
`const shown = lapse(hiring(filterProjects(all, filters, asOf)));`) and reconciles the pills
last via `pills.badge(active, hiringOnly)` (`:485`), whose last statement is `api.sync()`
(`site/devmap.js:723`). `sync()` still drops the unmatched value with no re-render,
`site/devmap.js:713-720`:
```js
        // A saved choice this metro doesn't carry (another metro's status) shows as All and is dropped.
        select.value = filters[key];
        if (select.value !== filters[key]) {
          select.value = '';
          filters = { ...filters, [key]: '' };
        }
```

### 3. Two-stage fetch calling `render()` on arrival, rebuilding the card mid-interaction — CONFIRMED
`site/markets-view.js:1034-1051`. `8e24e45` ("load a metro's full list when the market view
opens twice") did **not** address this; what it added is the stale-snapshot retry path:
```js
      if (snapshot !== shown || !Array.isArray(file?.projects)) {
        // Let a later render ask again rather than wait on this one forever.
        if (devFiles.get(city) === 'loading') devFiles.delete(city);
        return;
      }
      data.projects = [...data.projects.filter((p) => p.city !== city), ...file.projects];
      devFiles.set(city, 'done');
      render();
```
(`site/markets-view.js:1041-1048`). `render()` still begins `disposeMap()` (`:232`) and then
`$('m-body').replaceChildren(devMap(state.city || null, true) || mapMissing())` (`:238`), so
the whole card, its Leaflet map and its row set are rebuilt. `selected` is still card-local
(`site/devmap.js:369` area; set in `select()` at `:550`), so selection, list scroll and
viewport are still lost. The project objects are still replaced wholesale (`:1046`), so
object-keyed identity cannot survive.

### 4. Swallowed stage-2 fetch failure, with a guard that blocks retry — CONFIRMED
`site/markets-view.js:1050` `.catch(() => devFiles.set(city, 'failed'));` — and `'failed'`
is still read nowhere. `devFiles` appears only at `:55` (declaration), `:75` (`clear()`),
`:1036-1037`, `:1043`, `:1047`, `:1050`. The retry guard is still
`site/markets-view.js:1036` `if (!path || devFiles.has(city)) return;`, so a failed metro is
never retried and never reported; the error message from `:60`
(`throw new Error(\`${path} returned ${response.status}\`)`) is still discarded. `8e24e45`
clears `'loading'` on a stale-snapshot resolve but deliberately leaves `'failed'` sticky.

### 5. Slow-phone timing block measures but never asserts — CONFIRMED
`backend/test/browser/devmap-check.mjs:692-716`. The last `log()` call in the file is at
`:689` (`no page errors`); the block that follows emits only `console.log` rows (`:693-695`,
`:715`), so `results` is untouched and `failed` (`:721`) cannot be affected. Still only two
hardcoded metros (`:696` `for (const city of ['San Antonio', 'Houston']…`), and the
never-arriving-list case still prints a long time and passes: `:713`
`await page.waitForFunction(…, { timeout: 180000 }).catch(() => null);`. The two real
thresholds are still on unthrottled contexts (`:339` 400 ms search, `:355` "filter change
paints within 150 ms"). `dataset.drawMs` is still written (`site/devmap.js:1193`) and still
never read by the check (no match for `drawMs` in the check file).

### 6. Dead clustering residue — CONFIRMED
All four still present and still unread: `site/devmap.js:806` `const CELL = 64;` (only
occurrence of `CELL` in the file); `:1044` `let clusterOf = new Map();` with the stale
comment at `:1043` ("The cluster each project sat in at the last draw, for the list's
hover"); `:1095` `const nextCluster = new Map();` (never written); `:1186`
`clusterOf = nextCluster;`; `:1191` `node.dataset.clusters = '0';`. `speckAt` still uses its
own literal `let bestD = 64;` (`:982`). The rest of the `dataset.*` family
(`pins`, `drawn`, `specks`, `smallPins`, `matches`, `drawMs`) is a live test contract read by
`devmap-check.mjs`; `clusters` is the one member nothing reads, so the performance notes'
"delete it" conclusion stands. (`code-structure.md` holds the full dead-code inventory.)

### 7. Phone sheet geometry vs `select()`/`fit()` padding — CONFIRMED
Unchanged on both sides. CSS at ≤640px: `site/style.css:9086-9091`
`.devx-mapwrap.narrow .devx-panel { top: 22%; … }` (base narrow rule still `top: 40%`,
`site/style.css:8558-8559`). JS: `site/devmap.js:1304`
`const shift = wide() ? L.point(Math.min(420, w * 0.45) / 2, 0) : L.point(0, h * 0.28);`
and `site/devmap.js:1074` `paddingBottomRight: [… , open && narrow ? h * 0.62 : …]`. So the
0.28 shift still lands the pin at roughly the sheet's top edge, and 0.62 still understates
the 78% the sheet covers. (The padding line has been reworked around it — there is now a
`peek` value for narrow-and-closed, `site/devmap.js:1071` — but the `0.62` open case is
untouched.) The filters/chart are still hidden with the panel open on phones,
`site/style.css:8567-8569`.

### 8. Breakpoint mismatch, JS map width vs CSS viewport — CONFIRMED
`site/devmap.js:100` `const NARROW_MAP = 820;` and `site/devmap.js:1061`
`const wide = () => node.clientWidth >= NARROW_MAP;`, toggled in the observer at
`site/devmap.js:1212`. CSS still stacks at 900px (`site/style.css:8801`, `:9042`) and applies
sheet geometry at 640px (`site/style.css:8835`, `:9056`). Three different numbers, two
different reference boxes; the mixed-state window the reviewers described is intact.

### 9. Per-draw O(N) work — MIXED (two CONFIRMED, two FIXED)
- **Bitstring in `api.show()` — CONFIRMED.** `site/devmap.js:1245`
  `const key = projects.map((p) => (ids.has(p) ? 1 : 0)).join('');` then `if (key === last) return;`.
  Unchanged, and now also allocated once per time-lapse tick (280 ms interval, `:518`).
- **`filterProjects` three times per `apply()` — CONFIRMED.** `site/devmap.js:389, 391, 393`
  (`shown`, `forLegend` with `off: []`, `forChart` with `since: ''`). Now wrapped in `lapse()`
  for two of the three, which adds a fourth O(N) filter pass while the time-lapse runs.
- **Re-sort of `shown` by cost on every draw — CONFIRMED.** `site/devmap.js:1157`
  `const order = [...sited].sort((a, b) => (b === chosen) - (a === chosen) || (b.cost ?? 0) - (a.cost ?? 0));`
  still allocated and re-sorted per draw, i.e. per pan and zoom. `draw()` also now adds two
  further per-draw O(N) passes: `shown.filter((p) => !p.approximate)` (`:1136`) and the
  `spots` grouping loop (`:1139-1143`).
- **Per-project category color lookup — FIXED** by `53fb668`: memoised at
  `site/devmap.js:907-912` (`const colors = new Map(); const colorOf = (p) => …`), with the
  reason in the comment ("worked out once: draws on every filter change ask for thousands").
  `pillWidth(money(p.cost))` is likewise memoised now (`site/devmap.js:1166`
  `let w = pillW.get(p); if (w == null) pillW.set(p, (w = pillWidth(money(p.cost))));`).
- **Canvas reallocation on every `paintSpecks` — FIXED** by `b01ce73`:
  `site/devmap.js:919-925`, "Resizing a canvas reallocates it; only do that when the map's
  size changed", guarded by `if (speckCanvas.width !== size.x * ratio || …)`. The same commit
  batched dots and ZIP rings into one path per color (`:932-979`) and added off-screen
  speck culling (`:939`), so the hover/paint path the reviewers called hottest is materially
  better.

**Why the surviving three now matter more than when written.** The performance notes assumed
this work was interaction-driven and therefore self-limiting: a keystroke, a click, a pan. The
time-lapse changed that. While it plays, `apply()` runs on a 280 ms interval
(`site/devmap.js:516`), so the bitstring, the three (now four) `filterProjects` sweeps, the
per-draw re-sort and the marker churn all run about 3.5 times a second with no user input, for
as long as the lapse lasts. The reviewers' ranked bottleneck list is unchanged in content but
should be read as a sustained cost, not a per-gesture one.

## Other findings from the three notes

### MOOT
Only the deleted-view citations, listed under **Deletions** at the top of this file.

### CONFIRMED, unchanged in substance (current lines)
- No map state in the hash: `writeMarketHash`/`readMarketHash` still carry only
  `city, focus, sort, order, tool, compare` (`site/market.js:212-248`); filters/sort/hiring
  are still module globals (`site/devmap.js:61`, `:106`, `:108`).
- Breadcrumb out of the map still discards the city: `site/markets-view.js:971`
  `back: writeMarketHash({ ...state, tool: '', city: '' })`.
- `clearAll()` still does not reset `sort`: `site/devmap.js:378-383`.
- Legend `aria-pressed` still inverted relative to the action: `site/devmap.js:440`
  `button.setAttribute('aria-pressed', String(!off.has(key)))`.
- Map search still drives the smaller-filings box, and `onlyQuery` still gates the pins:
  `site/devmap.js:479-481`.
- No data-loading indicator and no empty-map overlay; `mapNode.dataset.matches` still the
  only signal (`site/devmap.js:486`).
- Eager row construction for every project before any filter:
  `site/devmap.js:364` `const items = drawList(all, …)`, `drawList` at `:1328`.
- `select()` still sweeps the whole `items` map and runs a `querySelectorAll` over the list
  (`site/devmap.js:551-557`), reads `row.offsetTop`/`list.scrollTop` right after those writes
  (`:559-561`), and reads `mapWrap.getBoundingClientRect().top` right after
  `panel.replaceChildren` + `classList.add('panel-open')` (`:563-568`). `close()` still runs
  two more full sweeps (`:587-588`). `step()` still `order.indexOf(selected)` (`:574`).
- The untested pure helpers (`money`, `sqft`, `dueDate`, `MONTH_FMT`, `monthLabel`,
  `locationNote`, `pinLabel`, `smallerOf`, `pillWidth`, `free`/fan-out geometry) are still
  unexported-or-untested and still covered only through the browser check; no
  `backend/test/devmap-site.test.ts` was added.
- `cache: 'no-cache'` on both fetches: `site/app.js:949`, `site/markets-view.js:59`.

### CHANGED
- **Speck click is a dead end — partly fixed.** `site/devmap.js:988-994`: a click on a
  speck whose project is `approximate` now opens the panel (`if (p?.approximate) onPick(p);`
  — commit `1e76ae9`); every other speck still only zooms
  (`else if (p) map.setView(…, Math.min(map.getZoom() + 2, SPREAD_ZOOM), …)`). Keyboard
  reachability of specks is still nil.
- **"Rings count as drawn" / off-map accounting.** `1e76ae9` reworked this: unverified
  projects are now always dashed ZIP rings at any zoom and are counted as drawn
  (`site/devmap.js:1132-1138`, `const rings = shown.length - sited.length;` with the comment
  "Rings count as drawn: the project is on the map, as an area"). Any finding phrased as
  "approximate pins are invisible/uncounted" no longer holds; the `.devx-leader`/dashed
  rendering is still unasserted in the check.

### FIXED
- Canvas reallocation per paint (`b01ce73`) and per-project color/pill-width recomputation
  (`53fb668`) — see headline #9.
- `loadDevFile` leaving a metro permanently stuck in `'loading'` after a snapshot swap
  (`8e24e45`, `site/markets-view.js:1041-1044`). This was a sub-point of the reviewers'
  stage-2 discussion; the swallowed-failure half is not fixed.

## New issues the earlier reviewers could not have seen

High confidence, all in the time-lapse added by `758ffc6`:

1. **`clearAll()` does not stop or clear the time-lapse.** `site/devmap.js:378-383` resets
   `filters` and `hiringOnly` only; `until` (`:371`) and `lapseTimer` (`:372`) are untouched.
   So "Clear all" during a running lapse leaves the interval running and the result set still
   capped at `until` (`:377` `const lapse = (rows) => (until ? rows.filter(…) : rows)`), while
   every pill reads "All" — the same shape as headline finding #2, from a different cause.
2. **The time-lapse is invisible to the "active filters" bookkeeping.** `active` is
   `activeFilterCount(filters) + (hiringOnly ? 1 : 0)` (`site/devmap.js:417`) and `until` is
   not part of `filters`, so `clear.hidden = !active` (`site/devmap.js:721`) hides the only
   escape hatch while the lapse is restricting the set, and the count renders
   "N projects" without the "of M" qualifier (`:419-424`). The `lapseChip` (`:373-374`) is
   the sole indication.
3. **The time-lapse has no test coverage at all.** `backend/test/browser/devmap-check.mjs`
   contains no match for `lapse`, `blip` or `keepView`; the only thing standing between a
   broken lapse and a green check is the `no page errors` assertion (`:689`). (The lapse's
   `setInterval` lifetime against the tab-away path is covered in `code-structure.md`; it is
   not restated here.)

## Undetermined
None. Every finding above resolved from code at HEAD.

---

# Accessibility notes — verification

`accessibility.md` (269 lines) landed after this pass began and is verified here. It read the
same stale 1341-line `site/devmap.js`; `site/style.css` has also moved, and the dev map's
layout was reworked "map-first" since the review, which changes one of its findings
materially. Nothing in it cites either deleted view.

### A1. Focus never moves into the detail panel / phone sheet — CONFIRMED
The machinery still exists and still nothing asks for it. `site/devmap.js:335`
`panel.tabIndex = -1;`; `site/devmap.js:550`
`function select(project, { fly = false, focus = false, reveal = false } = {}) {`;
`site/devmap.js:569` `if (focus) panel.focus({ preventScroll: true });`. Both callers are
unchanged in substance: the list row at `site/devmap.js:364`
`(project) => select(project, { fly: true, reveal: true })` and the pin at
`site/devmap.js:616` `(project) => select(project, { fly: true, focus: false })` — still an
explicit `focus: false`. `grep -n "focus: true" site/devmap.js` returns nothing. This remains
the highest-priority accessibility finding and is untouched by the 80 commits.

### A2. Phone layout inverts DOM vs visual order — CHANGED (effectively fixed)
The premise no longer holds. The card is now built map-first and the project dock is nested
*inside* the map wrap, `site/devmap.js:180-189`:
```js
  // Map-first: the map is the whole body; the project dock, filters, chart and panel float over it.
  const body = el('div', 'devx-body');
  const side = el('div', 'devx-side devx-glass');
  …
  const mapWrap = el('div', 'devx-mapwrap');
  mapWrap.append(side);
  body.append(mapWrap);
```
So there is no longer a `side`-then-`mapWrap` sibling pair for CSS to reverse, and
`.devx-mapwrap { order: -1; }` (`site/style.css:8807`, inside `@media (max-width: 900px)`) now
applies to the only child of `.devx-body` — vestigial, not an inversion. The reviewer's
WCAG 1.3.2 / 2.4.3 claim and the proposed fix at "devmap.js:186" are both moot as written.
Note the side effect: with `side` inside `mapWrap`, DOM order is now map-region-then-dock,
which is the order the reviewer recommended.
The related sub-findings still hold: `.devx-to-list` is still phone-only with `aria-controls`
and no `aria-expanded` (`site/devmap.js:155-161`, `site/style.css:9753`), and the filters and
chart are still `display: none` while the sheet is open (`site/style.css:8567-8569`).

### A3. `.devx-panel { outline: none }` — CONFIRMED
`site/style.css:8537-8552`, last declaration of the block: `outline: none;`. No
`:focus-visible` rule was added. Still masked in practice by A1.

### A4. Unguarded `behavior: 'smooth'` — CONFIRMED
`site/devmap.js:302` `details.scrollIntoView({ block: 'start', behavior: 'smooth' });` — the
one site with no `reduceMotion()` guard. The file has 7 `reduceMotion()` call sites; the two
neighbouring scrolls are both guarded (`site/devmap.js:561`, `:568`).

### A5. Leaflet's own `zoomAnimation` / `fadeAnimation` never disabled — CONFIRMED
`site/devmap.js:841` `const map = L.map(node, { scrollWheelZoom: true, zoomControl: false });`
— no animation options. `grep -n "zoomAnimation\|fadeAnimation" site/devmap.js` returns
nothing. `reduceMotion()` is honoured for `flyTo`/`setView` and the blip ring
(`site/devmap.js:1306-1307`, `:1256`), but Leaflet's tile fade and zoom animation still run.

### A6. Cost-by-category bar is `aria-hidden` with no text equivalent — CONFIRMED
`site/devmap.js:255` `bar.setAttribute('aria-hidden', 'true');`, and the bar is still built
from `byCost` as color segments alone (`site/devmap.js:433-442`: `const seg = el('i'); seg.style.background = c.color; seg.style.flexGrow = String(byCost.get(c.key));`).
The legend's per-category numbers are counts, not cost (`site/devmap.js:439` writes
`byCount`), so the cost split is still conveyed by color only.

### A7. `dataset.clusters = '0'` and the stale "clusters" vocabulary in the check — CONFIRMED
`site/devmap.js:1191` `node.dataset.clusters = '0';` (see headline #6 above). The check's
stale comment is now at `backend/test/browser/devmap-check.mjs:198`:
"Pins are category icons or counted clusters; the map reports how many projects they hold in
all." The misleading variable naming is also still there, `devmap-check.mjs:371`
`return { clusters: Number(map.dataset.specks), inClusters, … }` and the assertion built on it
at `:373`.

### A8. Touch target sizes — CONFIRMED
- Chart month bars: `site/style.css:8499-8509` `.devx-bar-col { flex: 1; … padding: 0; }` —
  still no `min-width`, so width is 1/N of the chart's width across 24 months.
- Sort buttons: `site/style.css:8120-8128` `.devx-seg-item { padding: 4px 10px; font: 400 12.5px var(--ui); … }`
  — no `min-height`; ~25px computed. The only other `.devx-seg-item` rules are transition and
  `:active` transform (`site/style.css:10537`, `:10547`, `:10558`), neither of which adds size.
  Both still fail WCAG 2.5.8 Target Size (Minimum, AA, 24×24) on the bar axis.

### A9. The "night basemap" is not theme-conditional — CONFIRMED
`site/style.css:8025-8027`:
```css
/* Night basemap: OpenStreetMap tiles darkened in the browser, no extra tile service. */
.devx .leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) brightness(0.82) contrast(0.92) saturate(0.6);
}
```
The rule sits in no `@media` block and carries no `[data-theme]` selector (checked by scanning
the preceding ~80 lines for either), and `.devx .leaflet-container { background: #16140f; }`
(`site/style.css:8029-8031`) is likewise unconditional. The "Contour across the rest of the
site" work did not move it. So the map is dark in light mode too, and the contrast pairs that
matter are the ones against the dark basemap in both themes.

### A10. The keyboard walk is skipped on mobile — CONFIRMED
`backend/test/browser/devmap-check.mjs:461` `if (!vp.mobile) {` still gates the tab-order and
focus-ring assertions. The file has six `vp.mobile` branches (`:140`, `:178`, `:187`, `:276`,
`:461`, `:548`); none of the newer ones adds a keyboard walk at 390px. The reviewer's broader
statement also holds: no match in the check file for `axe`, `prefers-reduced-motion`, or any
contrast or target-size measurement, and the time-lapse added since the review has no
accessibility assertions either (see "New issues" above).

### Also CONFIRMED from accessibility.md, briefly
- Pins destroyed under the keyboard user: `site/devmap.js:1181-1182`
  (`for (const marker of [...layer.getLayers()]) if (!want.has(marker)) layer.removeLayer(marker);`),
  reached from `redraw` on `zoomend moveend` (`:1199`) and from `apply()` → `map?.show(ids, …)`
  (`:488`). No `activeElement` rescue before removal.
- Specks, smaller-filing markers and community-report markers are still pointer-only:
  the canvas (`site/devmap.js:902-903`), `L.circleMarker` smaller pins (`:1009-1021`) and
  report pins (`:1026-1031`) get no `keyboard`/`onkeydown`; only `pinFor`'s div icons do
  (`site/devmap.js:886-892`).
- `close()`'s focus return is still conditional on focus being inside the panel
  (`site/devmap.js:590`), so focus on a removed pin is still not recovered; the `Escape`
  handler's unconditional return is unchanged (`site/devmap.js:594-601`).
- Selecting a project is still silent: `site/devmap.js:563-569` (`panel.replaceChildren(...)`,
  `panel.hidden = false`, `mapWrap.classList.add('panel-open')`) with no live region and no
  `aria-expanded` on the row; `aria-current="true"` at `:557` is the only trace.
