# Terra development map: code structure, state management and maintainability

Scope: `site/devmap.js` and its one host view `site/markets-view.js`, plus wiring in `site/app.js` / `site/config.js`.

**Two premise corrections, both verified — and the second one matters for how this report is read.**

1. **`devmap.js` has one host view, not three.** Only `site/markets-view.js` imports `developmentMap` (import at [:34](site/markets-view.js#L34), calls at [:972](site/markets-view.js#L972), [:977](site/markets-view.js#L977), [:980](site/markets-view.js#L980)). `site/deal-view.js` imports `CENTERS` alone, to derive a market list: `export const DEAL_MARKETS = Object.keys(CENTERS);` — [site/deal-view.js:9,13](site/deal-view.js#L9-L13).

2. **The working tree moved during this review, and the second Leaflet integration no longer exists.** I began against a checkout at `site/devmap.js` = 1341 lines with `site/property-view.js` and `site/career-view.js` present. The current `HEAD` (`8897046`) includes `d3b019e "Retire Property, Career and five Market tools; move Deal of the week to News"`, which **deleted both files**, plus three perf commits (`deef842`, `53fb668`, `b01ce73`) that grew `devmap.js` to **1599 lines** and added a time-lapse feature. Everything below has been **re-verified line by line against the current tree**; all line numbers are current. The coordinator's correction was therefore describing the new tree, and its "two independent Leaflet integrations" framing is now moot — see the dedicated section, which records what the retirement resolved and what it left behind.

Ranked summary (consequence first):

| # | Finding | Kind | Where |
|---|---|---|---|
| 1 | Leaflet map survives navigating away from the Markets tab — `disposeMap()` is never called on the `!open` path | correctness / leak | `site/markets-view.js:162-165` |
| 2 | **The time-lapse `setInterval` keeps running on a hidden tab**, re-filtering the whole metro every 280 ms — an amplifier of #1 | correctness / CPU | `site/devmap.js:508,516` |
| 3 | Filters/sort/hiring live in module globals; selection, viewport and chart state live per-card, so an async data arrival rebuilds the card and silently drops selection and viewport | correctness + state design | `site/devmap.js:58-62,106-108`; `site/markets-view.js:1034-1050` |
| 4 | User filter changes still force-refit the map, discarding pan/zoom — though `keepView` now exists and is used by the lapse only | correctness (UX) | `site/devmap.js:488,1241-1253` |
| 5 | `loadDevFile` swallows fetch failures — a metro silently shows a partial map | error handling | `site/markets-view.js:1050` |
| 6 | Two functions, 517 and 478 lines, holding 62% of the file and ~20 responsibilities between them | maintainability | `site/devmap.js:117-633,836-1313` |
| 7 | Dead clustering-era code to delete: `CELL`, `clusterOf`, `nextCluster`, `dataset.clusters='0'`; plus `toggleDetail`, `dueDate`'s export, `panel.prevStep` | maintainability | `site/devmap.js:602,806,1044,1095,1186,1191,1385,1576` |
| 8 | `CENTERS` in a map-rendering module is still a market-list source for another view | coupling | `site/deal-view.js:9,13` |
| 9 | No `devmap.d.ts` although sibling modules have one | contract gap | `site/*.d.ts` |

---

## How is state held and updated? Is there a single source of truth for filters, selection, sort and viewport?

### Takeaway
No single source of truth. Filters, sort and the hiring toggle are **module-level mutable globals** that outlive any card; selection, list order and the new time-lapse position are **closure-local** to one `developmentMap()` call; the viewport lives only inside Leaflet. The legend, chart, pills, list and map stay consistent only because one ~105-line `apply()` pass rewrites all of them — but the global/local split means a card rebuild keeps the filters and loses the selection.

### Cited Findings
- Filter state is a module global: `let filters = { ...EMPTY_DEV_FILTERS }; let filtersCity = null;` — [site/devmap.js:58-62](site/devmap.js#L58-L62)
- Sort and the hiring toggle are two more: `let sort = 'biggest';` ([:106](site/devmap.js#L106)) and `let hiringOnly = false;` ([:108](site/devmap.js#L108))
- Per-card closures, now including the time-lapse: `let until = ''; let lapseTimer = 0;` — [site/devmap.js:371-372](site/devmap.js#L371-L372) — alongside `selected`, `order`, `map`, `listTurn`.
- On a city change only `place` is reset: `if (filtersCity !== city) { filters = { ...filters, place: '' }; filtersCity = city; }` — [site/devmap.js:165-168](site/devmap.js#L165-L168). `cost`, `work`, `publicInvolvement`, `status`, `filed`, `query`, `off`, `sort` and `hiringOnly` all carry across metros.
- `filterPills.sync()` repairs the globals against this metro's option set by **writing to them from inside a render function**: `if (select.value !== filters[key]) { select.value = ''; filters = { ...filters, [key]: '' }; }` — [site/devmap.js:717-720](site/devmap.js#L717-L720)
- The DOM holds a second copy; `apply()` writes the search box back from the global every pass: `input.value = filters.query;` — [site/devmap.js:387](site/devmap.js#L387)
- `apply()` ([:386](site/devmap.js#L386)) derives three separately-masked filtered lists per pass — the full set, one ignoring the legend, one ignoring the chart's own month — so a keystroke costs three `filterProjects` sweeps of the metro.
- The map keeps a third derived copy plus a string fingerprint: `const key = projects.map((p) => (ids.has(p) ? 1 : 0)).join(''); if (key === last) return;` — [site/devmap.js:1245-1247](site/devmap.js#L1245-L1247)
- Chosen/hovered is tracked a fourth time inside `drawMap`, kept in step only via `api.select()`/`api.hover()`.
- Markets-view holds `mapCity` as yet another piece of map state for when the hash has no city — [site/markets-view.js:962-989](site/markets-view.js#L962-L989)

### Inferences
- Root of #3: when `loadDevFile` resolves it calls `render()` → `disposeMap()` → a fresh `developmentMap()` card ([site/markets-view.js:1046-1048](site/markets-view.js#L1046-L1048)). Filters survive (globals); `selected`, the open panel, list scroll, the viewport and any running time-lapse do not. On a large metro this lands after first paint, so a user who clicks a pin immediately sees the panel vanish.
- Bounded refactor: one `devMapState` object (`{ filters, sort, hiringOnly, selectedId, until, view }`) created by the host and passed into `developmentMap({ state })`, with the first half of `apply()` extracted as a pure `(all, state, asOf) → viewModel`. That removes `sync()`'s write-back, lets selection persist across a refresh keyed by `project.id` (rows already carry it), and makes the derive step testable without a DOM.
- Object-identity keying makes an incremental refresh impossible: `items` is a `Map` keyed by the project *object* ([site/devmap.js:1328-1366](site/devmap.js#L1328-L1366)) while `loadDevFile` replaces the project objects wholesale (`data.projects = [...data.projects.filter(...), ...file.projects]` — [site/markets-view.js:1045](site/markets-view.js#L1045)). Commit `7488160 "key pins and list rows by project, not id"` chose object keys deliberately; that is what forces the full rebuild.

### Gaps
- Filters are still not in the hash (`writeMarketHash` carries `tool` and `city` only — [site/markets-view.js:972](site/markets-view.js#L972)), so a filtered map is not linkable or back-button-restorable. Whether that is intended is not stated anywhere in the code.

---

## The second Leaflet integration: what the retirement resolved, and what it left behind

### Takeaway
The duplicate integration is **gone**. `d3b019e` deleted `site/property-view.js`, which had its own `liveMap`, its own `disposeMap()` missing devmap's Leaflet crash fix, and a duplicated boot sequence. No shared-lifecycle extraction is needed any more — there is one Leaflet integration. What survives is the weaker half of the old coupling: another view importing `CENTERS` from a map-rendering module for a market list, and `devmap.js` as the sole owner of an un-exported map lifecycle that nothing else can reuse if a second map returns.

### Cited Findings
- `site/property-view.js` and `site/career-view.js` are absent from the working tree and from `git ls-files site`; the last commit to touch `property-view.js` is `d3b019e "Retire Property, Career and five Market tools; move Deal of the week to News"`, which is an ancestor of `HEAD` (`git merge-base --is-ancestor d3b019e HEAD` succeeds).
- devmap's importers are now exactly two: `site/markets-view.js:34` (`developmentMap, disposeMap`) and `site/deal-view.js:9` (`CENTERS`) — `grep -rn "from './devmap.js'" site`.
- On the correction as given: in the pre-retirement tree, property-view's `disposeMap` did **not** shadow an imported one — `disposeMap` was absent from its import list (`import { ATTRIBUTION, CENTERS, loadLeaflet, TILES } from './devmap.js';`). It was an independently written module-private function of the same name. Weaker than shadowing (no import silently overridden, no linter warning suppressed), but the divergence it hid was real: devmap's disposer carries `liveMap.stop(); liveMap._animatingZoom = false;` before `remove()` with the reason in the comment ("Leaflet 1.9 ends a zoom animation with an untracked 250 ms timer that reads the map's panes…") — [site/devmap.js:85-95](site/devmap.js#L85-L95), added in the dedicated commit `ba42d22` — and property-view's three-line version did not.
- The lifecycle is still private and still keyed off a module global: `let liveMap = null;` ([site/devmap.js:59](site/devmap.js#L59)), with `if (map !== liveMap) return;` repeated as a staleness guard in eight places — [1089](site/devmap.js#L1089), [1212](site/devmap.js#L1212), [1225](site/devmap.js#L1225), [1235](site/devmap.js#L1235), [1244](site/devmap.js#L1244), [1256](site/devmap.js#L1256), [1268](site/devmap.js#L1268) and [1276](site/devmap.js#L1276) — one more than before, now that `blip` has its own.
- `drawMap`'s staleness guard is `if (!node.isConnected) return null;` ([site/devmap.js:838](site/devmap.js#L838)), which is only sound because its host **detaches** rather than hides: `$('m-body').replaceChildren(...)` — [site/markets-view.js:238](site/markets-view.js#L238). The retired property-view only hid its section, so the same guard would have passed there — the host contract, not the guard, was doing the work.
- `CENTERS` still duplicates a backend constant: `export const CITY_CENTERS: Record<City, [number, number]>` — [backend/src/market/developments.ts:104](backend/src/market/developments.ts#L104), used at [:539](backend/src/market/developments.ts#L539) and [:1090](backend/src/market/developments.ts#L1090).

### Inferences
- **Do not extract a shared map-lifecycle helper now.** With one integration it would be an abstraction with a single caller. The right residue of that analysis is smaller: keep the `stop()`/`_animatingZoom` teardown as the one canonical disposer, and if a second map ever appears, give it `createMap`/`destroyMap` from the start rather than letting it re-derive a boot sequence.
- **Do move `CENTERS`.** `deal-view.js` importing a map module for `Object.keys(CENTERS)` is the same coupling the retired views had, one caller smaller. Moving it to `market.js` (which already owns `City`-shaped types in `market.d.ts`) costs two import edits and is a prerequisite for a clean `devmap.d.ts`.
- **Replace the global-as-liveness-oracle.** Eight `map !== liveMap` checks and an `isConnected` check that is only valid because of a host's detach behaviour are both symptoms of liveness being inferred rather than stated. An explicit token — `const alive = () => !cancelled`, set by `disposeMap` — makes the invariant local and survives a future second map or a host that hides instead of detaching.

### Gaps
- I reviewed the retired `property-view.js` only in the pre-`d3b019e` checkout; I did not diff `d3b019e` to confirm whether any of its map code was moved into `deal-view.js` rather than deleted. `deal-view.js` imports only `CENTERS`, which suggests not, but I did not read that file beyond its imports.

---

## Is logic duplicated across devmap.js and its host view? Near-identical blocks within devmap.js?

### Takeaway
With the second integration retired, cross-module duplication is down to the `CENTERS` market list. Within `devmap.js` the repetition is real but local: the staleness guard 7×, the pin-pair idiom 4×, two month formatters, and a popup that duplicates the detail panel's body.

### Cited Findings
- `if (map !== liveMap) return;` 8× — see the line list in the previous section.
- The "both caches for this project" idiom repeats with slightly different bodies at [site/devmap.js:1046](site/devmap.js#L1046) (`for (const icon of [pins.get(project)?.getElement(), pills.get(project)?.getElement()])`), [1188](site/devmap.js#L1188) (`setZIndexOffset(1000)`) and in `api.select` (`setZIndexOffset(0)`).
- Marker repositioning written twice verbatim: `if (!marker.getLatLng().equals(at)) marker.setLatLng(at);` — [site/devmap.js:1103](site/devmap.js#L1103) and [1173](site/devmap.js#L1173).
- Two month formatters from different input shapes: `monthLabel` for `YYYY-MM` keys ([site/devmap.js:738-742](site/devmap.js#L738-L742)) and `MONTH_FMT` for ISO dates ([site/devmap.js:1399-1402](site/devmap.js#L1399-L1402)).
- `smallPopup` builds `.dev-pop` / `.dev-pop-title` / `.dev-pop-line` rows ([site/devmap.js:1372-1383](site/devmap.js#L1372-L1383)) duplicating the address/cost/work/status/owner block of `projectPanel` ([site/devmap.js:1434-1513](site/devmap.js#L1434-L1513)).
- `money()` is private to devmap ([site/devmap.js:1586-1592](site/devmap.js#L1586-L1592)); `el()` ([:1594](site/devmap.js#L1594)) and `link()` ([:1540](site/devmap.js#L1540)) are redefined per view file across `site/`.

### Inferences
- The `monthLabel`/`MONTH_FMT` pair and `money`/`el`/`link` belong in a shared `site/fmt.js`; that is a mechanical move with no behaviour change and it shrinks every view file slightly.
- `smallPopup` should call a `detailBody(project, { compact: true })` extracted from `projectPanel`, which is also one of the extractions #6 wants.

### Gaps
- I did not check whether `site/style.css` is relied on cross-module now that `.dev-map` has only one consumer; the retired property-view had reused that class for its drive map.

---

## How are DOM events and map handlers registered, and are they ever removed?

### Takeaway
Card-scoped DOM listeners are safe — they are attached to nodes inside the card and die with it. The defect is that **navigating away from the Markets tab tears nothing down**: the map, its handlers, its ResizeObserver *and a 280 ms `setInterval` that re-filters the whole metro* all stay live on a hidden subtree.

### Cited Findings
- The leak path. `show()` hides the markets section and returns before any teardown:
  ```js
  for (const name of ['jobs', 'markets', 'tracker']) $(`${name}-view`).hidden = name !== active;
  …
  if (!open) {
    delete document.body.dataset.workspace;
    return;
  }
  ```
  — [site/markets-view.js:154-165](site/markets-view.js#L154-L165)
- `disposeMap()` is called from only two places: `setMarketLoader` ([site/markets-view.js:76](site/markets-view.js#L76)) and the top of `render()` ([:232](site/markets-view.js#L232)). Neither runs on a tab change, because a tab change hits that early return. `show` is the sole `hashchange` handler for the view.
- **#2, the active leak.** The time-lapse interval is cleared only by `stopLapse` (user pause / months exhausted) or from inside its own tick:
  ```js
  const tick = () => {
    // Another city's map replaced this one.
    if (!box.isConnected) return clearInterval(lapseTimer);
    …
    until = lapseMonths[i++];
    apply();
    …
    map?.blip(…);
  };
  lapseTimer = setInterval(tick, 280);
  ```
  — [site/devmap.js:506-517](site/devmap.js#L506-L517); `clearInterval` elsewhere only at [:521](site/devmap.js#L521). The guard tests `box.isConnected`, and the tab-away path **hides** rather than detaches ([site/markets-view.js:154](site/markets-view.js#L154)) — so with a lapse playing, leaving the tab leaves it playing: `apply()` (three `filterProjects` sweeps of the metro) plus `map.blip()` marker churn every 280 ms, on an invisible tab, until the months run out. The comment on that guard ("Another city's map replaced this one") shows it was written for the city-change case only.
- Still live on the hidden tab: `map.on('zoomend moveend', redraw)` ([site/devmap.js:1199](site/devmap.js#L1199)); two `map.on('click', …)` ([:989](site/devmap.js#L989), [:1032](site/devmap.js#L1032)); `map.on('mousemove', …)` ([:996](site/devmap.js#L996)); `zoomstart`/`zoomend` canvas toggles ([:1001-1002](site/devmap.js#L1001-L1002)); a canvas in Leaflet's overlay pane; and the ResizeObserver.
- The observer self-disconnects only once `remove()` has run, and meanwhile mutates global page layout:
  ```js
  const observer = new ResizeObserver(() => { if (map !== liveMap) return observer.disconnect(); … fitWorkspace(wrap, !wide()); … });
  observer.observe(node);
  map.on('unload', () => observer.disconnect());
  ```
  — [site/devmap.js:1211-1219](site/devmap.js#L1211-L1219); `fitWorkspace` writes `wrap.style.height` from `nav.tabs`' position and reads `document.body.dataset.workspace`, which markets-view has just deleted ([site/markets-view.js:163](site/markets-view.js#L163)).
- Uncancelled timers that are merely guarded, not cleared: the search debounce `typing = setTimeout(apply, 120)` ([site/devmap.js:247](site/devmap.js#L247)); a refit kick `setTimeout(() => map?.refit?.(), 280)` ([:222](site/devmap.js#L222)); the deferred list tail, turn-counter-guarded ([:404](site/devmap.js#L404)); `blip`'s ring markers, each self-removing after 950 ms ([:1261-1263](site/devmap.js#L1261-L1263)).
- The Leaflet `<script>`/`<link>` go in `document.head` and are removed only on error ([site/devmap.js:64-82](site/devmap.js#L64-L82)) — correct for a cached singleton; noted only so it is not mistaken for the leak.

### Inferences
- Fix #1 with one line: call `disposeMap()` before the `return` in the `!open` branch. It is already imported and idempotent (`if (liveMap)` then nulls it). This does **not** fix #2 — the interval lives in the card closure, not the map.
- Fix #2 properly by making teardown explicit: have `developmentMap()` return the card plus a `destroy()` that runs `stopLapse({ redraw: false })`, `clearTimeout(typing)`, bumps `listTurn` and calls `disposeMap()`, and have markets-view call it on the `!open` path and at the top of `render()`. A cheaper stopgap is to change the tick guard from `box.isConnected` to `box.isConnected && !box.closest('[hidden]')`, but that treats the symptom.
- The deeper lesson for both: `isConnected` is a valid staleness guard only while the host detaches. Three separate guards here (`node.isConnected`, `box.isConnected`, `map !== liveMap`) each encode an assumption about the host that the host does not state.

### Gaps
- Not reproduced in a browser. `backend/test/browser/devmap-check.mjs` waits on `.dev-map` dataset attributes ([:152](backend/test/browser/devmap-check.mjs#L152)) and has no tab-away or teardown case, so nothing in CI would catch either leak.

---

## Are render paths idempotent? Can a re-render double-append, re-register handlers, or lose selection?

### Takeaway
DOM writes are genuinely idempotent — everything is `replaceChildren` or a build-once-reuse `Map`, so no double-append and no duplicate handler registration. The failures are elsewhere: a card rebuild loses selection, viewport and lapse position, and user filter changes still refit the map.

### Cited Findings
- Idempotent by construction: `list.textContent = ''; list.append(...)` ([site/devmap.js:400-401](site/devmap.js#L400-L401)); `bar.replaceChildren(...)` ([:434](site/devmap.js#L434)); `node.replaceChildren(head, bars, axis)` in `drawChart` ([:748-812](site/devmap.js#L748-L812)); `panel.replaceChildren(...projectPanel(...))` ([:563](site/devmap.js#L563)).
- Build-once, reuse: `drawList` returns `project → item` ([site/devmap.js:1328-1366](site/devmap.js#L1328-L1366)); `pinFor` memoises per project per shape (`const cache = pill ? pills : pins; let marker = cache.get(project); if (marker) return marker;`). `filterPills` and `drawList` are each called once per card, outside `apply()` — the structural reason re-render cannot duplicate handlers.
- Selection survives `apply()` within one card: `if (selected && !ids.has(selected)) close(); else if (selected) step(0);` — [site/devmap.js:489-490](site/devmap.js#L489-L490). It does not survive the rebuild `loadDevFile` triggers.
- **#4 is now half-fixed.** `api.show` takes a view-preserving flag — `show(ids, { keepView = false } = {}) { … if (keepView && fitted) draw(); else fit(); }` — [site/devmap.js:1241-1253](site/devmap.js#L1241-L1253) — but the only caller passes it for the time-lapse: `map?.show(ids, { keepView: Boolean(until) });` — [site/devmap.js:488](site/devmap.js#L488). A user's own filter or legend change still lands in `fit()`, which unconditionally `fitBounds`/`setView` ([site/devmap.js:1203-1209](site/devmap.js#L1203-L1209)) and throws away their pan/zoom.
- `apply()` runs twice on first paint — synchronously at [:612](site/devmap.js#L612) and again after the map resolves at [:621](site/devmap.js#L621) — so first render does six `filterProjects` sweeps.
- Selecting a project whose row is still in the deferred tail past `FIRST_ROWS = 300` ([site/devmap.js:98](site/devmap.js#L98)) silently skips scroll-into-view: `if (row?.isConnected)` — [:559](site/devmap.js#L559).
- `select()` walks the whole item map plus two `querySelectorAll` passes over the list on every selection, including every `step(0)` from `apply()`.

### Inferences
- #4 is now a one-word fix with a known-good mechanism: pass `keepView: true` for user-driven filter/legend/sort changes and keep `fit()` for a city change or a first non-empty result (`if (!fitted || cityChanged) fit()`). The highest user-visible win in this review for the smallest diff.
- Drop the synchronous `apply()` at [:612](site/devmap.js#L612), or memo `apply` on a shallow compare of `{filters, sort, hiringOnly, until}` so an identical pass is skipped — this also removes three of the lapse's per-tick sweeps.
- `select()` should toggle two nodes using the remembered previous selection (`items.get(prev)`) instead of sweeping all rows.

### Gaps
- Whether the lost-selection case fires in production depends on `data.files?.[city]` being populated ([site/markets-view.js:1035](site/markets-view.js#L1035)), which the build sets; I did not read the exporter.

---

## How large are the largest functions, and which carry several responsibilities?

### Takeaway
Two functions now hold **62%** of the file and both grew with the perf and time-lapse work: `developmentMap` 517 lines (was 373) and `drawMap` 478 (was 395). Every extractable piece of pure logic is written as a closure over mutable locals, so none of it is reachable from a unit test.

### Cited Findings
- `developmentMap` — [site/devmap.js:117-633](site/devmap.js#L117-L633), **517 lines**: title row and city switcher; global filter reconciliation ([:165-168](site/devmap.js#L165-L168)); data derivation and a hiring memo; search box + debounce ([:247](site/devmap.js#L247)); summary/cost bar/legend; sort segment; list + empty state + map key; the coverage-note prose builder; `apply()` ([:386-491](site/devmap.js#L386-L491)); the whole time-lapse engine — `playLapse` ([:497-518](site/devmap.js#L497-L518)), `stopLapse` ([:520-527](site/devmap.js#L520-L527)), `lapseChip`, `until`, `lapseTimer`; `select`/`step`/`close`; the Escape handler; and async map boot ([:615-625](site/devmap.js#L615-L625)).
- `drawMap` — [site/devmap.js:836-1313](site/devmap.js#L836-L1313), **478 lines**: boot; pin/pill icon factory; a canvas speck renderer with hand-rolled hit-testing; smaller-filing markers; community-report markers; the report-pin drop tool; fit-padding math; the `draw` pass with ring/spiral fan-out and pill overlap packing; the ResizeObserver/workspace sizing; and a now 8-method `api` including `blip` ([:1255](site/devmap.js#L1255)) and `refit`.
- `projectPanel` — [site/devmap.js:1405-1521](site/devmap.js#L1405-L1521), 117 lines, including schedule progress-bar math.
- `drawChart` has grown two more parameters: `function drawChart(node, months, since, onPick, stack = null, lapse = null)` — [site/devmap.js:748](site/devmap.js#L748) — six positional arguments, two of them nullable callbacks.
- `filterPills` — [site/devmap.js:657-746](site/devmap.js#L657-L746) — writes the module-global `filters` from its own change handler and from `sync()`.
- Precedent for extraction exists: the filtering/sorting/category/month-bucketing logic already lives in `market.js` with a typed contract (`filterProjects`, `sortProjects`, `filingsByMonth`, `projectCategory`, `filterChoices`, `activeFilterCount` — [site/market.d.ts:115-120](site/market.d.ts#L115-L120)), imported at [site/devmap.js:12-26](site/devmap.js#L12-L26).

### Inferences
- Five bounded extractions, each independently shippable and DOM-free:
  1. `packPills(points, {pillW, chosen, view}) → {pills, specks}` from the zoomed-out branch of `draw` — pure given plain `{x,y}` points, and directly testable for the overlap invariant the browser check only asserts indirectly ([backend/test/browser/devmap-check.mjs:365](backend/test/browser/devmap-check.mjs#L365)).
  2. `fanOffsets(n) → {dx,dy}[]` — the ring/spiral geometry with `L.point` replaced by tuples; testable for "no two icons closer than PIN".
  3. `fitPadding({w, h, open, narrow})`.
  4. `coverageNote(all, city, asOf)` — pure prose assembly currently inseparable from the card.
  5. **`lapseEngine(months, { onTick, interval })`** — new, and the best candidate of the five: the time-lapse is a self-contained state machine (`until`, `lapseTimer`, play/pause/end) tangled into a 517-line DOM builder, and pulling it out is also what makes finding #2 fixable in one place.
- Plus `devMapView(all, state, asOf) → {shown, order, forLegend, forChart, counts, byCost, byCount}` from the first half of `apply()`.
- `drawChart`'s six positional parameters should become `drawChart(node, { months, since, onPick, stack, lapse })` — a mechanical change that stops the next feature adding a seventh.
- A file split along existing function boundaries is low-risk: `devmap-pins.js` (`drawMap` + icon/speck helpers), `devmap-panel.js` (`projectPanel`, `locationNote`, `links`, `smallPopup`, `sqft`), `devmap-bids.js` (`bidsSection`, `dueDate`), leaving `devmap.js` as the card shell.

### Gaps
- No ESLint/complexity config inspected, so I cannot say whether a function-length rule exists and is being suppressed.

---

## Is error handling present where data or the map library can fail?

### Takeaway
The Leaflet load path is well handled and recoverable. Everything else fails silently: a per-metro fetch failure is recorded in a `Map` value nobody reads, and missing data degrades to an empty map rather than a message. One improvement has landed since my first pass — a stuck `'loading'` entry is now cleared.

### Cited Findings
- Handled well: `script.onerror = () => { leaflet = null; script.remove(); reject(new Error("Couldn't load the map.")); };` — [site/devmap.js:74-78](site/devmap.js#L74-L78) — consumed by `.catch((error) => { mapNode.replaceChildren(stateBox(error instanceof Error ? error.message : "Couldn't load the map.", 'error')); })` — [site/devmap.js:623-625](site/devmap.js#L623-L625). Nulling `leaflet` makes a retry possible.
- Partly improved: `loadDevFile` now releases a stale in-flight entry — `// Let a later render ask again rather than wait on this one forever. if (devFiles.get(city) === 'loading') devFiles.delete(city);` — [site/markets-view.js:1041-1043](site/markets-view.js#L1041-L1043).
- Still silently swallowed: `.catch(() => devFiles.set(city, 'failed'))` — [site/markets-view.js:1050](site/markets-view.js#L1050). Nothing reads `'failed'`, and `if (!path || devFiles.has(city)) return;` ([:1036](site/markets-view.js#L1036)) means a failed metro is neither retried nor reported. The user sees truncated counts with no indication anything is missing — and the loader throws a perfectly good message that is discarded: `throw new Error(\`${path} returned ${response.status}\`)` ([:60](site/markets-view.js#L60)).
- Missing data degrades quietly: `const all = cityProjects(data?.projects, city);` / `const asOf = data?.asOf ?? new Date().toISOString();` — [site/devmap.js:169-170](site/devmap.js#L169-L170). The only empty copy is the note's `'No projects to show yet.'` and the filtered-out row.
- Nothing guards the synchronous render against a throw: `apply()` at [:612](site/devmap.js#L612) runs `filterProjects`/`sortProjects`/`filingsByMonth` uncaught, and the card goes straight into `$('m-body').replaceChildren(devMap(state.city || null, true) || mapMissing());` ([site/markets-view.js:238](site/markets-view.js#L238)) — so one malformed project row blanks the whole Markets body.
- The right pattern is already in the same file for the top-level snapshot: `message(\`Couldn't load market data. ${…}\`, true)` — [site/markets-view.js:180](site/markets-view.js#L180).
- Optional-chained map calls (`map?.show(...)`, `map?.showSmall(...)`, `map?.blip(...)`) mean the full pipeline runs and the list updates while the map silently does nothing, with no state beyond the initial `'Loading the map…'` placeholder.

### Inferences
- Fix #5 in ~10 lines: on failure `devFiles.set(city, 'failed')` **and** `render()`, and have the card show a `stateBox('Some of this metro's projects could not be loaded…', 'error')` when the host passes `partial: true`. Converts the worst failure mode — quietly wrong counts — into a visible one.
- Wrap the first synchronous `apply()` in try/catch with a `stateBox` fallback. Cheap insurance for data scraped from TABS and city permit portals.

### Gaps
- I did not establish whether `site/market.json` can ship `files` entries for metros whose file is absent, which sets how often the silent path fires.

---

## Does the module's public surface match its .d.ts contract?

### Takeaway
There is still no `site/devmap.d.ts`, though sibling modules — including a view module, `insights-view.d.ts` — have one. The untyped surface has drifted: of nine exports, two are dead, one is exported but used only in-module, and one is a constants-only dependency for an unrelated view.

### Cited Findings
- Exports: `TILES`, `ATTRIBUTION`, `CENTERS`, `loadLeaflet` ([:64](site/devmap.js#L64)), `disposeMap` ([:85](site/devmap.js#L85)), `developmentMap` ([:117](site/devmap.js#L117)), `toggleDetail` ([:1385](site/devmap.js#L1385)), `bidsSection` ([:1552](site/devmap.js#L1552)), `dueDate` ([:1576](site/devmap.js#L1576)).
- A repo-wide grep outside `site/devmap.js` returns **nothing** for `toggleDetail`, `dueDate` or `prevStep`; `bidsSection` is exported but called only inside its own module. The retirement commit removed consumers without removing the exports.
- `toggleDetail` carries an unused 4th-parameter default that rebuilds the category map per call: `render = (p) => projectPanel(p, { catOf: new Map(categoryList().map((c) => [c.key, c])), hiring: [] })` — [site/devmap.js:1385](site/devmap.js#L1385).
- Another dead handle: `panel.prevStep = () => step(-1);` — [site/devmap.js:602](site/devmap.js#L602) — a method attached to a DOM node with no reader anywhere in `site/` or `backend/test/`.
- **Dead clustering-era code — delete, no design analysis needed.** Clustering was superseded by price-pill overlap packing (`09457d1`, following `ad2de4f` which had introduced clustering). Four residues, all verified unread:
  - `const CELL = 64;` commented "Cluster grid cell, in screen pixels" — [site/devmap.js:805-806](site/devmap.js#L805-L806). Never referenced; the speck hit-test uses its own literal.
  - `let clusterOf = new Map();` — [site/devmap.js:1044](site/devmap.js#L1044) — assigned at [:1186](site/devmap.js#L1186), never read; its comment still claims "The cluster each project sat in at the last draw, for the list's hover".
  - `const nextCluster = new Map();` — [site/devmap.js:1095](site/devmap.js#L1095) — created, never written to.
  - `node.dataset.clusters = '0';` — [site/devmap.js:1191](site/devmap.js#L1191) — hardcoded, and the one member of the `dataset.*` family no test reads.
- Constants-only coupling persists one caller smaller: `import { CENTERS } from './devmap.js'; export const DEAL_MARKETS = Object.keys(CENTERS);` — [site/deal-view.js:9,13](site/deal-view.js#L9-L13).

### Inferences
- Bounded change for #8/#9: move `CENTERS` to `market.js`, then add `site/devmap.d.ts` declaring `developmentMap(options)`, `disposeMap()`, `loadLeaflet()`, `TILES`, `ATTRIBUTION` — and **delete** `toggleDetail`, `dueDate`'s export, `panel.prevStep` and the four clustering residues rather than typing them. Writing the `.d.ts` is what forces the `developmentMap` option bag (`{data, cities, city, bids, onCity, back}` — [site/devmap.js:117](site/devmap.js#L117)) to be named, which is the same object the state refactor in #3 would change, so the two land naturally together.
- **Caution for any cleanup:** `dataset.pins`, `drawn`, `specks`, `smallPins`, `matches` and `drawMs` ([site/devmap.js:1190-1193](site/devmap.js#L1190-L1193), [:1230](site/devmap.js#L1230), [:1250](site/devmap.js#L1250)) are a de facto test contract read by `backend/test/browser/devmap-check.mjs` ([:199](backend/test/browser/devmap-check.mjs#L199), [:363](backend/test/browser/devmap-check.mjs#L363), [:627](backend/test/browser/devmap-check.mjs#L627)) and must not be removed. `dataset.clusters` is the only one nothing reads.

### Gaps
- I did not check whether the repo runs `tsc` with `checkJs` over `site/`, which determines whether a new `.d.ts` would be enforced or decorative. The `site-build-and-test` skill names a typecheck step but I did not read its config.
