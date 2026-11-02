# Terra development map: code structure, state management and maintainability

Scope: `site/devmap.js` (1341 lines) and its callers `site/markets-view.js`, `site/career-view.js`, `site/property-view.js`, plus wiring in `site/app.js` / `site/config.js`. All citations are local files at `/home/user/Terra`; "Source" links are repo-relative paths with line numbers. No `site/devmap.d.ts` exists.

Ranked summary (consequence first):

| # | Finding | Kind | Where |
|---|---|---|---|
| 1 | Leaflet map survives navigation away from the Markets tab — `disposeMap()` is never called on the `!open` path | correctness / leak | `site/markets-view.js:159-161` |
| 2 | `property-view.js` keeps a second, divergent `liveMap`/`disposeMap` pair that is missing the zoom-animation crash fix | correctness | `site/property-view.js:65,811-814` vs `site/devmap.js:85-95` |
| 3 | Filters/sort/hiring live in module globals; selection, viewport and chart state live per-card, so an async data arrival rebuilds the card and silently drops selection and viewport | correctness + state design | `site/devmap.js:58-62,106-108,320-324`; `site/markets-view.js:851-864` |
| 4 | Every filter change refits the map bounds, destroying the user's pan/zoom; the viewport has no owner | correctness (UX defect) | `site/devmap.js:972-978,1010-1021` |
| 5 | `loadDevFile` swallows fetch failures — a metro silently shows a partial or empty map | error handling | `site/markets-view.js:851-864` |
| 6 | Two 400-line functions (`developmentMap`, `drawMap`) each hold 6+ responsibilities and no pure logic is extractable as written | maintainability | `site/devmap.js:117-489,664-1058` |
| 7 | Dead public surface: `toggleDetail`, `panel.prevStep`, `clusterOf`/`nextCluster`, `dataset.clusters='0'` | maintainability | `site/devmap.js:472,832,873,954,959,1127-1139` |
| 8 | `CENTERS` in a map-rendering module is the de-facto market list for two other views | coupling | `site/career-view.js:27,34,442`; `site/property-view.js:10,60` |
| 9 | No `devmap.d.ts` although 19 sibling modules have one | contract gap | `site/*.d.ts` listing |
| 10 | Two separate `map.on('click')` handlers with interdependent guards | maintainability | `site/devmap.js:780-784,821-826` |

---

## How is state held and updated? Is there a single source of truth for filters, selection, sort and viewport?

### Takeaway
There is no single source of truth. Filters, sort and the hiring toggle are **module-level mutable globals** that outlive any card; selection and list order are **closure-local** to one `developmentMap()` call; the viewport lives only inside Leaflet and is recomputed from scratch on every filter change. The legend, chart, pills, list and map are each separately derived in one 80-line `apply()` pass, so they stay consistent only because that pass rewrites all of them — but the split between global and per-card state means a card rebuild keeps the filters and loses the selection.

### Cited Findings
- Filter state is a module global, not owned by the card: `let filters = { ...EMPTY_DEV_FILTERS }; let filtersCity = null;` — [site/devmap.js:58-62](site/devmap.js#L58-L62)
- Sort and the hiring toggle are two more module globals: `let sort = 'biggest';` and `let hiringOnly = false;` — [site/devmap.js:106-108](site/devmap.js#L106-L108)
- Selection, list order and a render token are per-card closures: `let map = null; let order = []; let selected = null; let listTurn = 0;` — [site/devmap.js:320-324](site/devmap.js#L320-L324)
- On a city change only `place` is reset, so `cost`, `work`, `publicInvolvement`, `status`, `filed`, `query`, `off`, `sort` and `hiringOnly` carry across metros: `if (filtersCity !== city) { filters = { ...filters, place: '' }; filtersCity = city; }` — [site/devmap.js:165-168](site/devmap.js#L165-L168)
- `filterPills.sync()` exists purely to repair the globals against this metro's option set, mutating `filters` from inside a render function: `select.value = filters[key]; if (select.value !== filters[key]) { select.value = ''; filters = { ...filters, [key]: '' }; }` — [site/devmap.js:574-584](site/devmap.js#L574-L584)
- The `<select>` elements and `input` hold a second copy of the filter state; `apply()` writes the search box back from the global on every pass: `input.value = filters.query;` — [site/devmap.js:334](site/devmap.js#L334)
- Legend, cost bar, chart and map each run their own `filterProjects` with a different mask in the same pass (three filtered lists per keystroke) — [site/devmap.js:336-340](site/devmap.js#L336-L340)
- The map keeps a third derived copy of "what is shown" plus a string fingerprint to detect change: `const key = projects.map((p) => (ids.has(p) ? 1 : 0)).join(''); if (key === last) return;` — [site/devmap.js:1014-1020](site/devmap.js#L1014-L1020)
- Chosen/hovered project is tracked a *fourth* time inside `drawMap` (`let hovered = null; let chosen = null;`), kept in step with the card's `selected` only by the `api.select()`/`api.hover()` calls — [site/devmap.js:829-830](site/devmap.js#L829-L830)
- Markets-view holds yet another piece of map state, `mapCity`, used when the hash has no city — [site/markets-view.js:779-806](site/markets-view.js#L779-L806)

### Inferences
- The global/local split is the root of finding #3: when `loadDevFile` resolves it calls `render()` → `disposeMap()` → a brand-new `developmentMap()` card. Filters survive (globals), but `selected`, the open panel, the list scroll position and the map viewport do not. For a large metro this fires after the first paint, so a user who clicks a pin immediately can see their panel vanish.
- A bounded refactor: introduce one `devMapState` object (`{ filters, sort, hiringOnly, selectedId, city, view }`) created by the host view and passed into `developmentMap({ state })`, with `apply()` as a pure `(all, state, asOf) → viewModel` function plus a thin DOM patch step. That removes `filterPills.sync()`'s write-back, lets selection persist across a data refresh (keyed by `project.id`, which rows already carry — [site/devmap.js:1075](site/devmap.js#L1075)), and makes the derive step unit-testable without a DOM.
- Keying selection by object identity rather than id is itself fragile: `items` is a `Map` keyed by the project *object* ([site/devmap.js:1071-1104](site/devmap.js#L1071-L1104)) and `loadDevFile` replaces the project objects wholesale (`data.projects = [...data.projects.filter(...), ...file.projects]` — [site/markets-view.js:859](site/markets-view.js#L859)), so no identity can survive a refresh. Commit `7488160` ("key pins and list rows by project, not id") deliberately moved to object keys; that choice is what makes the refresh non-incremental.

### Gaps
- Nothing persists filters to the URL hash: `writeMarketHash` carries `tool` and `city` only ([site/markets-view.js:789](site/markets-view.js#L789)), so a filtered map is not linkable or back-button-restorable. Whether that is intended is not stated in the code or comments.

---

## Is logic duplicated across devmap.js and its three host views? Near-identical blocks within devmap.js?

### Takeaway
Yes, in three places that matter. The most consequential is a duplicated **map lifecycle**: `property-view.js` reimplements `liveMap` + `disposeMap()` and has not received the Leaflet zoom-animation fix that `devmap.js` carries. Inside `devmap.js`, the pin-decoration, "is this still the live map" guard and money/date formatting are each repeated several times.

### Cited Findings
- `property-view.js` imports only the constants and the loader from devmap — `import { ATTRIBUTION, CENTERS, loadLeaflet, TILES } from './devmap.js';` — [site/property-view.js:10](site/property-view.js#L10) — and then keeps its own `let liveMap = null;` — [site/property-view.js:65](site/property-view.js#L65)
- Its disposer is the naive version: `function disposeMap() { liveMap?.remove(); liveMap = null; }` — [site/property-view.js:811-814](site/property-view.js#L811-L814)
- devmap's disposer carries a fix for a real crash, with the reason in the comment: "Leaflet 1.9 ends a zoom animation with an untracked 250 ms timer that reads the map's panes; once remove() has deleted them that timer throws" → `liveMap.stop(); liveMap._animatingZoom = false; liveMap.remove();` — [site/devmap.js:84-95](site/devmap.js#L84-L95)
- That fix was a dedicated commit, `ba42d22 "Map: clear Leaflet's zoom-animation flag before removing the map"` — `git log --oneline -- site/devmap.js`
- The map boot sequence is duplicated nearly line for line: devmap does `L.map(node, …); map.attributionControl.setPrefix('<a href="https://leafletjs.com" …>Leaflet</a>'); L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map); liveMap = map; map.setView(CENTERS[city] ?? [31, -99], 9)` — [site/devmap.js:669-675](site/devmap.js#L669-L675) — and property-view does the same four calls with the same prefix string — [site/property-view.js:757-765](site/property-view.js#L757-L765)
- `career-view.js` imports `CENTERS` only to destructure it unguarded: `const [lat, lng] = CENTERS[city];` — [site/career-view.js:442](site/career-view.js#L442) — where `city` is `state.city || CAMPUSES.find(...)?.city || 'Dallas'` ([site/career-view.js:437](site/career-view.js#L437)) and `state.city` comes from the hash. Elsewhere the same file guards it (`city.value = MARKETS.includes(state.city) ? state.city : '';` — [site/career-view.js:93](site/career-view.js#L93)), so the destructure is the unguarded path.
- Within devmap, the "pin for this project, in either cache" idiom appears four times with slightly different bodies: [site/devmap.js:834](site/devmap.js#L834), [site/devmap.js:956](site/devmap.js#L956), [site/devmap.js:1035](site/devmap.js#L1035) (`for (const m of [pins.get(was), pills.get(was)]) m?.setZIndexOffset(0);`).
- `if (map !== liveMap) return;` is repeated as a staleness guard in seven places: [868](site/devmap.js#L868), [981](site/devmap.js#L981), [994](site/devmap.js#L994), [1004](site/devmap.js#L1004), [1013](site/devmap.js#L1013), [1023](site/devmap.js#L1023), [1031](site/devmap.js#L1031).
- Marker position updates are written twice verbatim: `if (!marker.getLatLng().equals(at)) marker.setLatLng(at);` at [site/devmap.js:882](site/devmap.js#L882) and [site/devmap.js:941](site/devmap.js#L941).
- Month formatting exists twice in the same file, from different input shapes: `monthLabel` for `YYYY-MM` keys — [site/devmap.js:600-603](site/devmap.js#L600-L603) — and `MONTH_FMT` for ISO dates — [site/devmap.js:1141-1144](site/devmap.js#L1141-L1144).
- `money()` is private to devmap ([site/devmap.js:1328-1334](site/devmap.js#L1328-L1334)) while `property.js` exports its own `money` that property-view imports ([site/property-view.js:35](site/property-view.js#L35)) — two money formatters in the same site.
- Popup bodies overlap heavily: `smallPopup` builds `.dev-pop` + `.dev-pop-title` + `.dev-pop-line` rows ([site/devmap.js:1114-1124](site/devmap.js#L1114-L1124)) duplicating the address/cost/work/status/owner block of `projectPanel` ([site/devmap.js:1176-1255](site/devmap.js#L1176-L1255)).

### Inferences
- Bounded fix for #2: export a `createMap(node, { city, scrollWheelZoom })` and reuse devmap's `disposeMap`, deleting property-view's copies. That is a ~20-line change and removes the known-crash divergence outright. Keeping two module-global `liveMap`s also means devmap's own `map !== liveMap` staleness guards can read `true` while a property-tab map is on screen, which is confusing even where it is not yet wrong.
- Bounded fix for the repeated guard: hoist `const stale = () => map !== liveMap;` or better, give `drawMap` an explicit `alive` flag set by `disposeMap`, so the module global stops being the liveness oracle.
- `CENTERS[city] ?? [31, -99]` is guarded in devmap ([675](site/devmap.js#L675), [975](site/devmap.js#L975)) but not in career-view; the safest bounded change is to move the market list out of devmap (see coupling, below) and make `CENTERS` lookups go through a `centerOf(city)` helper that returns the state fallback.

### Gaps
- I did not run the app, so the career-view `CENTERS[city]` throw is a code-path inference from hash-derived input, not an observed crash. It needs `readCareerHash` to be checked for city validation; `site/career.d.ts` and `career.js` were out of my assigned reading set.

---

## How are DOM events and map handlers registered, and are they ever removed? Anything that survives a view change?

### Takeaway
Card-scoped DOM listeners are safe (they are attached to nodes inside the card and die with it). The real defect is that the **Leaflet map and its ResizeObserver survive navigating away from the Markets tab**: `show()` returns early on the `!open` branch without calling `disposeMap()`, so the map, its tile layer, its `zoomend moveend` handler, its canvas overlay and its ResizeObserver stay live on a hidden subtree for as long as the user is on another tab.

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
  — [site/markets-view.js:154-161](site/markets-view.js#L154-L161)
- `disposeMap()` is called from only two places in markets-view: `setMarketLoader` (sign-out / loader change) — [site/markets-view.js:73](site/markets-view.js#L73) — and the top of `render()` — [site/markets-view.js:227](site/markets-view.js#L227). Neither runs on a tab change, because a tab change hits the `!open` early return above.
- `show` is the sole `hashchange` handler for this view: `window.addEventListener('hashchange', show);` — [site/markets-view.js:104](site/markets-view.js#L104)
- What stays alive: `map.on('zoomend moveend', redraw)` — [site/devmap.js:968](site/devmap.js#L968); `map.on('click', …)` twice — [780](site/devmap.js#L780), [821](site/devmap.js#L821); `map.on('mousemove', …)` — [785](site/devmap.js#L785); `map.on('zoomstart'/'zoomend', …)` — [790-791](site/devmap.js#L790-L791); a canvas appended into Leaflet's overlay pane — `map.getPanes().overlayPane.appendChild(speckCanvas)` — [731](site/devmap.js#L731).
- The ResizeObserver self-disconnects only via the liveness check or Leaflet's `unload`, both of which require `remove()` to have been called:
  ```js
  const observer = new ResizeObserver(() => { if (map !== liveMap) return observer.disconnect(); … });
  observer.observe(node);
  map.on('unload', () => observer.disconnect());
  ```
  — [site/devmap.js:980-988](site/devmap.js#L980-L988)
- That observer mutates global page layout, so a surviving map keeps writing to the DOM: `fitWorkspace(wrap, !wide())` sets `wrap.style.height` from `nav.tabs`' position — [site/devmap.js:983](site/devmap.js#L983), [site/devmap.js:495-506](site/devmap.js#L495-L506) — and reads `document.body.dataset.workspace`, which markets-view has just deleted ([site/markets-view.js:160](site/markets-view.js#L160)).
- By contrast, `property-view.js` does dispose on its own hidden path: `if (!next.open) { disposeMap(); return; }` — [site/property-view.js:100-104](site/property-view.js#L100-L104). The pattern markets-view needs already exists next door.
- A debounce timer also outlives the card: `let typing = 0; … typing = setTimeout(apply, 120);` — [site/devmap.js:203-209](site/devmap.js#L203-L209) — with no `clearTimeout` on teardown. The follow-up `apply` is harmless only because `map?.show()` re-checks `map !== liveMap` ([site/devmap.js:1013](site/devmap.js#L1013)); the comment at [1011-1012](site/devmap.js#L1011-L1012) documents exactly this hazard rather than removing it.
- Likewise the deferred list-tail append: `requestAnimationFrame(() => setTimeout(() => { if (turn !== listTurn) return; … }, 0))` — [site/devmap.js:349-357](site/devmap.js#L349-L357) — guarded by a turn counter, not cancelled.
- The Leaflet `<script>`/`<link>` are appended to `document.head` and only removed on error — [site/devmap.js:64-82](site/devmap.js#L64-L82). That is correct (the loader is a cached singleton), worth noting only so it is not mistaken for the leak.

### Inferences
- The one-line fix for #1 is to call `disposeMap()` (imported already at [site/markets-view.js:28](site/markets-view.js#L28)) before the `return` in the `!open` branch. Low risk: `disposeMap` is idempotent (`if (liveMap)` guard, then nulls it — [site/devmap.js:89-94](site/devmap.js#L89-L94)).
- A second, bounded hardening: have `developmentMap()` return the card plus a `destroy()` that clears `typing`, bumps `listTurn` and calls `disposeMap()`, and have both host views call it. That makes teardown explicit instead of relying on the `map !== liveMap` sentinel scattered in seven places.
- Because `drawMap` itself calls `disposeMap()` before creating a new map ([site/devmap.js:667](site/devmap.js#L667)), the leak is self-healing the moment the user returns to the map — which is probably why it has not been noticed. The cost while away is a live tile layer and a layout-mutating observer, not unbounded growth.

### Gaps
- I did not measure the leak in a browser; `backend/test/browser/devmap-check.mjs` waits on `.dev-map` dataset attributes ([backend/test/browser/devmap-check.mjs:152](backend/test/browser/devmap-check.mjs#L152)) and has no tab-away/teardown case, so no existing check would catch it.

---

## Are render paths idempotent? Can a re-render double-append, re-register handlers, or lose selection?

### Takeaway
The DOM write paths are genuinely idempotent — everything goes through `replaceChildren` or a build-once-reuse `Map` — so no double-append or duplicate handler registration. The idempotency failures are elsewhere: a re-render **loses the selection and the viewport**, and the map viewport is force-refit on every filter change.

### Cited Findings
- Idempotent by construction: `list.textContent = ''; list.append(...rows.slice(0, FIRST_ROWS), empty);` — [site/devmap.js:347-348](site/devmap.js#L347-L348); `bar.replaceChildren(...)` — [378](site/devmap.js#L378); `node.replaceChildren(head, bars, axis)` in `drawChart` — [628](site/devmap.js#L628); `panel.replaceChildren(...projectPanel(...))` — [433](site/devmap.js#L433).
- Rows and markers are created once and reused, so their listeners are registered once: `drawList` returns `project → item` ([site/devmap.js:1070-1107](site/devmap.js#L1070-L1107)) and `pinFor` memoises per project per shape (`const cache = pill ? pills : pins; let marker = cache.get(project); if (marker) return marker;` — [site/devmap.js:693-697](site/devmap.js#L693-L697)).
- `filterPills` and `drawList` are each called exactly once per card ([289](site/devmap.js#L289), [319](site/devmap.js#L319)), outside `apply()` — the structural reason re-render cannot duplicate handlers.
- Selection survives `apply()` only within one card: `if (selected && !ids.has(selected)) close(); else if (selected) step(0);` — [site/devmap.js:410-411](site/devmap.js#L410-L411). It does **not** survive the card rebuild that `loadDevFile`'s `render()` triggers — [site/markets-view.js:861](site/markets-view.js#L861).
- Viewport is refit on every filter change, not preserved: `show()` ends with `fit()` ([site/devmap.js:1020](site/devmap.js#L1020)) and `fit()` unconditionally `map.fitBounds(…)` / `map.setView(CENTERS[city] ?? …)` — [site/devmap.js:972-978](site/devmap.js#L972-L978). The `fitted` flag only suppresses a *second* fit from the ResizeObserver ([985](site/devmap.js#L985)), never from `show()`.
- `apply()` runs twice on first paint — once synchronously at [474](site/devmap.js#L474) and again after the map resolves at [482](site/devmap.js#L482) — so every first render does three `filterProjects` passes twice over the whole metro.
- A subtle non-idempotency in selection scrolling: `if (row?.isConnected)` — [site/devmap.js:429](site/devmap.js#L429) — so selecting a project whose row is still in the deferred tail (beyond `FIRST_ROWS = 300`, [98](site/devmap.js#L98)) silently skips the scroll-into-view.
- Each `select()` walks the whole item map plus two `querySelectorAll` passes over the list: `for (const [p, item] of items) { … } … for (const node of list.querySelectorAll('.dev-pick[aria-current]')) …` — [site/devmap.js:422-428](site/devmap.js#L422-L428). With thousands of rows this runs on every pin hover-to-click and on every `step(0)` from `apply()`.

### Inferences
- Bounded fix for #4: make `fit()` fire only when the shown set was previously empty or the city changed, and otherwise keep the current view — e.g. `if (!fitted || cityChanged) fit(); else draw();` in `api.show`. Alternatively expose `api.show(ids, { refit })` and let `apply()` pass `refit: false` for user-driven filter changes. This is the highest user-visible win for the smallest diff.
- Bounded fix for the double first-paint: drop the synchronous `apply()` at [474](site/devmap.js#L474) in favour of a cheap "list only" first pass, or make `apply()` skip the three-mask recompute when the filter object is identical to the last one (a shallow-compare memo on `{filters, sort, hiringOnly}`).
- `select()`'s O(all rows) class sweep should track the previously selected row and toggle two nodes instead; `items.get(prev)` is already available.

### Gaps
- I could not confirm whether the lost-selection-on-refresh case is reachable in production, because it depends on `data.files?.[city]` being populated ([site/markets-view.js:852](site/markets-view.js#L852)), which is set by the build (`backend/src/bin/…`, outside my reading set).

---

## How large are the largest functions, and which carry several responsibilities?

### Takeaway
Two functions hold 57% of the file: `developmentMap` (373 lines) and `drawMap` (395 lines). Both are "build DOM + wire events + derive view model + drive Leaflet" in one scope, and the derivable, testable parts — pill-packing, fan-out geometry, the summary/legend/count derivation — are all written as closures over mutable locals, so none of them is reachable from a unit test today.

### Cited Findings
- `developmentMap` — [site/devmap.js:117-489](site/devmap.js#L117-L489), 373 lines. Responsibilities, in order of appearance: breadcrumb/title row and city switcher ([121-163](site/devmap.js#L121-L163)); global filter reconciliation ([165-168](site/devmap.js#L165-L168)); data derivation and a hiring memo ([169-178](site/devmap.js#L169-L178)); search box + debounce ([190-209](site/devmap.js#L190-L209)); summary/cost bar/legend construction ([211-236](site/devmap.js#L211-L236)); sort segment ([238-255](site/devmap.js#L238-L255)); list + empty state + map key ([267-282](site/devmap.js#L267-L282)); the coverage-note prose builder ([305-317](site/devmap.js#L305-L317)); `apply` ([333-412](site/devmap.js#L333-L412)); `select`/`step`/`close` ([420-461](site/devmap.js#L420-L461)); the Escape handler ([464-471](site/devmap.js#L464-L471)); and async map boot ([476-487](site/devmap.js#L476-L487)).
- `drawMap` — [site/devmap.js:664-1058](site/devmap.js#L664-L1058), 395 lines: map boot ([665-677](site/devmap.js#L665-L677)); pin/pill icon factory ([693-725](site/devmap.js#L693-L725)); a hand-rolled canvas speck renderer with its own hit-testing ([730-791](site/devmap.js#L730-L791)); smaller-filing markers ([795-812](site/devmap.js#L795-L812)); community report markers ([813-819](site/devmap.js#L813-L819)); the report-pin drop tool ([820-826](site/devmap.js#L820-L826)); fit padding math ([848-859](site/devmap.js#L848-L859)); the `draw` pass with ring/spiral fan-out and pill overlap packing ([867-962](site/devmap.js#L867-L962)); the ResizeObserver/workspace sizing ([979-988](site/devmap.js#L979-L988)); and the 6-method public `api` ([991-1056](site/devmap.js#L991-L1056)).
- `projectPanel` — [site/devmap.js:1147-1263](site/devmap.js#L1147-L1263), 117 lines: header nav, body, tiles, schedule progress-bar math (`const pct = Math.max(0, Math.min(100, ((Date.now() - a) / Math.max(1, b - a)) * 100));` — [1205](site/devmap.js#L1205)), hiring box, people `<dl>`, footer links and the follow button.
- `filterPills` — [site/devmap.js:518-597](site/devmap.js#L518-L597), 80 lines, and it writes the module-global `filters` from inside its own change handler ([534](site/devmap.js#L534)) and from `sync()` ([580](site/devmap.js#L580)).
- Pure logic sitting inside closures, each a natural extraction: `pillWidth` ([639](site/devmap.js#L639)) is already free, but the packing loop that uses it ([924-946](site/devmap.js#L924-L946)) depends on `shown`, `chosen`, `pillW`, `px` and `view`; the fan-out geometry ([887-911](site/devmap.js#L887-L911)) depends on `map.project`/`unproject` and `L.point`; `padding()` ([849-859](site/devmap.js#L849-L859)) depends on `node`/`wrap` only through four numbers.
- Precedent for the extraction exists in the codebase: the map's filtering, sorting, category and month-bucketing logic already lives in `market.js` with a typed contract — `filterProjects`, `sortProjects`, `filingsByMonth`, `projectCategory`, `filterChoices`, `activeFilterCount` — [site/market.d.ts:115-120](site/market.d.ts#L115-L120), imported at [site/devmap.js:12-26](site/devmap.js#L12-L26).

### Inferences
- Four bounded extractions, each independently shippable and unit-testable without a DOM:
  1. `packPills(points, {pillW, chosen, view}) → {pills, specks}` from [924-946](site/devmap.js#L924-L946) — pure given plain `{x,y}` points; directly testable for the overlap invariant the browser check currently asserts indirectly ([backend/test/browser/devmap-check.mjs:365](backend/test/browser/devmap-check.mjs#L365)).
  2. `fanOffsets(n) → {dx,dy}[]` from [887-911](site/devmap.js#L887-L911) — the ring/spiral math with `L.point` replaced by a tuple; testable for "no two icons closer than PIN".
  3. `fitPadding({w, h, open, narrow})` from [848-859](site/devmap.js#L848-L859).
  4. `coverageNote(all, city, asOf)` from [305-317](site/devmap.js#L305-L317) — 13 lines of pure prose assembly currently inseparable from the card.
  Plus a `devMapView(all, state, asOf)` returning `{shown, order, forLegend, forChart, counts, byCost, byCount}` extracted from the first half of `apply()` ([333-394](site/devmap.js#L333-L394)).
- A file split along the existing seams would be low-risk because the seams are already function boundaries: `devmap-pins.js` (`drawMap` + icon/speck helpers), `devmap-panel.js` (`projectPanel`, `locationNote`, `links`, `smallPopup`, `sqft`), `devmap-bids.js` (`bidsSection`, `dueDate`), leaving `devmap.js` as the card shell. `el`, `money` and `link` ([1282-1341](site/devmap.js#L1282-L1341)) would move to a shared helper — `el` in particular is redefined per view file.

### Gaps
- No ESLint/complexity config was inspected, so I cannot say whether a lint rule already caps function length and is being suppressed here.

---

## Is error handling present where data or the map library can fail?

### Takeaway
The Leaflet load path is the one well-handled failure: it rejects with a user-readable message and the card shows an error box. Everything else fails silently — a per-metro data fetch that 404s or throws is swallowed into a `Map` value nobody reads, and the data-shape guards are optional chains that turn missing data into an empty map rather than a message.

### Cited Findings
- Handled well: `script.onerror = () => { leaflet = null; script.remove(); reject(new Error("Couldn't load the map.")); };` — [site/devmap.js:74-78](site/devmap.js#L74-L78) — consumed by `.catch((error) => { mapNode.replaceChildren(stateBox(error instanceof Error ? error.message : "Couldn't load the map.", 'error')); })` — [site/devmap.js:484-486](site/devmap.js#L484-L486). Resetting `leaflet = null` also makes a retry possible.
- Silently swallowed: the per-metro project file. `.catch(() => devFiles.set(city, 'failed'))` — [site/markets-view.js:863](site/markets-view.js#L863) — and no reader of the `'failed'` value exists; the only check is `if (!path || devFiles.has(city)) return;` ([site/markets-view.js:853](site/markets-view.js#L853)), which means a failed metro is never retried **and** never reported. The user sees the truncated cap-level project list with no indication anything is missing.
- The loader itself throws a useful message that is then discarded: `throw new Error(`${path} returned ${response.status}`)` — [site/markets-view.js:57](site/markets-view.js#L57).
- Missing data degrades to a blank-ish card rather than a state box: `const all = cityProjects(data?.projects, city);` and `const asOf = data?.asOf ?? new Date().toISOString();` — [site/devmap.js:169-170](site/devmap.js#L169-L170). The only explicit empty copy is the note's `: 'No projects to show yet.'` ([site/devmap.js:317](site/devmap.js#L317)) and the hidden-by-filters row ([276](site/devmap.js#L276)).
- Nothing guards the synchronous render against a throw: `apply()` at [474](site/devmap.js#L474) runs `filterProjects`/`sortProjects`/`filingsByMonth` with no try/catch, and `developmentMap` is called straight into `replaceChildren` — `$('m-body').replaceChildren(devMap(state.city || null, true) || mapMissing());` — [site/markets-view.js:233](site/markets-view.js#L233). A malformed project row therefore blanks the whole markets body.
- By contrast, the market snapshot fetch *is* handled with a message: `message(`Couldn't load market data. ${…}`, true)` — [site/markets-view.js:180](site/markets-view.js#L180) — the pattern the per-metro loader should copy.
- Also silent: optional-chained map calls (`map?.show(ids)`, `map?.showSmall(...)` — [site/devmap.js:404](site/devmap.js#L404), [409](site/devmap.js#L409)) mean the whole filter pipeline runs and updates the list while the map silently does nothing, with no "map still loading" state beyond the initial `'Loading the map…'` placeholder ([288](site/devmap.js#L288)).
- `property-view.js` shows the right shape for a degraded dependency — the isochrone fetch falls back to circles and says so in the UI: `nodes.push(el('p', 'calc-warning', `The routing server didn't answer, so these are straight-line circles at ${FALLBACK_MPH} mph …`))` — [site/property-view.js:803](site/property-view.js#L803).

### Inferences
- Bounded fix for #5: set `devFiles.set(city, 'failed')` *and* re-`render()`, and have the card render a `stateBox('Some of this metro's projects could not be loaded…', 'error')` above the list when the host passes `partial: true`. Roughly 10 lines across the two files, and it converts the worst failure mode (quietly wrong counts) into a visible one.
- A `try { apply() } catch` around the first synchronous render, falling back to `stateBox`, would stop one bad row from blanking the Markets tab. Cheap insurance given the data is machine-scraped from TABS and city permit portals.

### Gaps
- I did not trace whether `site/market.json` can legitimately ship `files` entries for metros whose file is absent, which determines how often the silent-failure path actually fires.

---

## Does the module's public surface match its .d.ts contract?

### Takeaway
There is no `site/devmap.d.ts`, although 19 sibling modules have one — including a view module, `insights-view.d.ts`, so the "views don't get types" explanation does not hold. The untyped surface has already drifted: of eight exports, two are dead and two are consumed only as incidental constants by unrelated views.

### Cited Findings
- `.d.ts` files present: `access, career, deal, devreports, events, feed, growth, insights-view, labels, market, news, property, school, sites, tracker, underwrite, underwrite-xlsx, unsubscribe, watch` — `ls site/*.d.ts`. No `devmap.d.ts`.
- devmap's eight exports: `TILES` ([33](site/devmap.js#L33)), `ATTRIBUTION` ([34](site/devmap.js#L34)), `CENTERS` ([37](site/devmap.js#L37)), `loadLeaflet` ([64](site/devmap.js#L64)), `disposeMap` ([85](site/devmap.js#L85)), `developmentMap` ([117](site/devmap.js#L117)), `toggleDetail` ([1127](site/devmap.js#L1127)), `bidsSection` ([1294](site/devmap.js#L1294)), `dueDate` ([1318](site/devmap.js#L1318)).
- Dead exports — a repo-wide grep for each name outside `site/devmap.js` returns nothing for `toggleDetail` and `dueDate`; `bidsSection` is exported but used only inside its own module (`const bidList = bidsSection(bids, city);` — [site/devmap.js:302](site/devmap.js#L302)).
- `toggleDetail` carries a 4th-parameter default that rebuilds the category map on every call and is itself unused: `render = (p) => projectPanel(p, { catOf: new Map(categoryList().map((c) => [c.key, c])), hiring: [] })` — [site/devmap.js:1127](site/devmap.js#L1127).
- Dead internals alongside them: `let clusterOf = new Map();` ([832](site/devmap.js#L832)) is assigned from `nextCluster` ([954](site/devmap.js#L954)) which is created ([873](site/devmap.js#L873)) and never written, and never read; the comment still claims "The cluster each project sat in at the last draw, for the list's hover" ([831](site/devmap.js#L831)). `node.dataset.clusters = '0';` ([959](site/devmap.js#L959)) is a hardcoded leftover — clustering was replaced by price pills in `09457d1 "Dev map: price pills with Halo icons on a night basemap"`, and the commit before it, `ad2de4f`, had introduced the clustering this code is the residue of.
- Another dead handle: `panel.prevStep = () => step(-1);` ([site/devmap.js:472](site/devmap.js#L472)) attaches a method to a DOM node; grep finds no reader anywhere in `site/` or `backend/test/`.
- Surface used as an incidental constants module: `CENTERS` is imported by `career-view.js` ([27](site/career-view.js#L27)) and `property-view.js` ([10](site/property-view.js#L10)) purely to produce their market lists — `const MARKETS = Object.keys(CENTERS);` in both ([site/career-view.js:34](site/career-view.js#L34), [site/property-view.js:60](site/property-view.js#L60)).
- `CENTERS` duplicates a backend constant: `export const CITY_CENTERS: Record<City, [number, number]>` — [backend/src/market/developments.ts:104](backend/src/market/developments.ts#L104) — used for metro-radius tests at [539](backend/src/market/developments.ts#L539) and [1090](backend/src/market/developments.ts#L1090).

### Inferences
- Bounded change for #8/#9: move `CENTERS`/`MARKETS` into `market.js` (which already owns `City`-shaped types in `market.d.ts`) or a small `markets.js`, so `career-view.js` and `property-view.js` stop importing a map-rendering module for a constant. Then add `site/devmap.d.ts` declaring `developmentMap(options)`, `disposeMap()`, `loadLeaflet()`, `TILES`, `ATTRIBUTION` — and delete `toggleDetail`, `dueDate`'s export, `panel.prevStep`, `clusterOf`/`nextCluster` and `dataset.clusters` rather than typing them. Writing the `.d.ts` is what forces the `developmentMap` option bag (`{data, cities, city, bids, onCity, back}` — [117](site/devmap.js#L117)) to be named, which is the same object the state refactor in #3 would change.
- The browser check reads `dataset.specks`, `dataset.drawn`, `dataset.pins`, `dataset.smallPins` and `dataset.matches` ([backend/test/browser/devmap-check.mjs:199,363,627](backend/test/browser/devmap-check.mjs#L199)) — so those dataset writes ([958-961](site/devmap.js#L958-L961), [408](site/devmap.js#L408), [999](site/devmap.js#L999), [1019](site/devmap.js#L1019)) are a *de facto* test contract and must not be removed in a cleanup. `dataset.clusters` is the one in that family that nothing reads.

### Gaps
- I did not check whether the repo runs `tsc` with `checkJs` over `site/`, which would determine whether adding `devmap.d.ts` is enforced or decorative. `site-build-and-test` names a typecheck step but I did not read its config.
