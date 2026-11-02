# Terra development map — user flows and interaction design

Scope: `site/devmap.js` (1341 lines), its only host `site/markets-view.js`, and the
section under the map (`site/devreports-view.js`, `site/devreports.js`). Filter/sort
primitives live in `site/market.js`; layout in `site/style.css`.

Two corrections to the brief, established from the code:

- **`career-view.js` and `property-view.js` do not embed the development map.** They
  import only constants/helpers from it: `site/career-view.js:27` `import { CENTERS }`
  and `site/property-view.js:10` `import { ATTRIBUTION, CENTERS, loadLeaflet, TILES }`.
  `property-view.js` builds its own unrelated Leaflet map (`site/property-view.js:757-764`)
  and has its own local `disposeMap` (`site/property-view.js:811`), which shadows the
  devmap one — so the two maps do not coordinate teardown. `developmentMap` is called
  only from `site/markets-view.js:789, 794, 797`.
- **There are no clustered pins any more.** Commit `ad2de4f` ("category icons,
  clustering and fan-out") was superseded by `09457d1` ("price pills ... on a night
  basemap"). The cluster bookkeeping is now dead code: `nextCluster` is created and
  never written (`site/devmap.js:874`), assigned to `clusterOf` (`:954`) which nothing
  reads, and `node.dataset.clusters` is hard-coded `'0'` (`:959`). Overlapping pins are
  now price pills + canvas "specks".

---

## Entry points, and the state the map arrives in

### Takeaway
Three entry points, all going through `#markets&tool=map&city=…`. The URL carries only
the city; every other piece of map state (filters, chart month, sort, hiring toggle,
selected project, viewport) lives in module-level variables, so the map can arrive
carrying another city's filters, and the breadcrumb out of the map throws the city away.

### Cited findings
- Entry points: the metro side panel of the overview (`site/markets-view.js:311-313`,
  `'Development map'` → `writeMarketHash({ ...state, tool: 'map', city: market.city })`);
  the teaser card on the development group and on a city page
  (`site/markets-view.js:823-844`, link at `:841`, rendered from `:250` and `:553`); and
  any pasted/bookmarked hash.
- The hash only encodes `city, focus, sort, order, tool, compare` — `writeMarketHash`,
  `site/market.js:238-248`. None of the map's own state is in it. `readMarketHash`
  (`site/market.js:212-236`) has no map keys.
- Filters, sort and the hiring toggle are module globals, deliberately kept across
  redraws: `site/devmap.js:60-61` `/** The map's filters, kept while the section redraws
  or the city changes (the town resets with the city). */ let filters = { ...EMPTY_DEV_FILTERS };`,
  plus `let sort = 'biggest'` (`:106`) and `let hiringOnly = false` (`:108`).
- Only `place` is reset when the city changes: `site/devmap.js:165-168`
  `if (filtersCity !== city) { filters = { ...filters, place: '' }; filtersCity = city; }`.
  `cost`, `work`, `publicInvolvement`, `status`, `filed`, `since`, `off` and `query` all
  carry over, as does `sort` and `hiringOnly`.
- The breadcrumb out of the map discards the city: `site/markets-view.js:789`
  `back: writeMarketHash({ ...state, tool: '', city: '' })`, rendered as the
  "Market data" link at `site/devmap.js:125-127`.
- City switching inside the workspace uses `history.replaceState`
  (`site/markets-view.js:130-135`, comment: "changing a dropdown should not fill the back
  button's history"), so switching Dallas → Houston → Austin leaves no intermediate
  history entries.

### Inferences
- **Bug (context carried in wrongly).** Arriving from the Dallas side-panel link after
  having filtered Houston to "Cost: $50M+ / Filed: last 30 days / chart month Mar '25"
  shows a Dallas map pre-filtered by those, with "Clear all" visible and the count
  reading "12 of 3,480 projects". The entry link looks like a fresh start and is not.
  Fix: reset `filters`/`sort`/`hiringOnly` when the entry comes from a link (e.g. treat
  a `tool` transition into `map` as a fresh mount), or put the filters in the hash so the
  state the user sees is the state the URL claims.
- **Bug (context lost on exit).** Entering from the Dallas city page and clicking
  "Market data" lands on All markets, not Dallas — a one-way trip.
  `back: writeMarketHash({ ...state, tool: '' })` would preserve it.
- **Bug (state lost on reload / deep link).** Nothing but the city survives a reload or
  a shared link: a user who filters to "$100M+ hospitals filed since Jan" cannot send
  that view to a colleague, and a refresh silently resets it. The natural fix is a few
  more hash keys (`cost`, `work`, `filed`, `since`, `off`, `q`, `sort`, `hiring`, and the
  selected project id) written with `replaceState` from `apply()`.

### Gaps
- Whether the browser restores the `devx-list` scroll position on back/forward cannot be
  determined from code; the list is rebuilt from scratch in `apply()` (`site/devmap.js:347-348`).

---

## Filter, search, sort and city-selection flows

### Takeaway
The flows are mostly coherent and `Clear all`/`Clear filters` do fully reset the filter
object — but there is a genuine dead end when a metro-specific filter value does not
exist in the newly selected city: the view renders zero results while every filter pill
reads "All", and the offending filter is dropped *after* filtering without re-applying.

### Cited findings
- `apply()` computes results first and reconciles the pills last:
  `site/devmap.js:336` `const shown = hiring(filterProjects(all, filters, asOf));` …
  `site/devmap.js:407` `pills.badge(active, hiringOnly);` which ends with `api.sync()`
  (`site/devmap.js:591`).
- `sync()` silently drops a value the metro does not carry, with no re-render:
  `site/devmap.js:574-583`
  ```js
  select.value = filters[key];
  if (select.value !== filters[key]) { select.value = ''; filters = { ...filters, [key]: '' }; }
  ```
  The comment at `:576` acknowledges the case ("another metro's status").
- The empty state's wording names only two of the eight filters:
  `site/devmap.js:274-276` `'Try a wider cost range or filing window, or '` + "Clear filters".
- `clearAll()` resets the filter object and the hiring toggle but not the sort:
  `site/devmap.js:326-331` `filters = { ...EMPTY_DEV_FILTERS }; hiringOnly = false; pills.sync(); apply();`.
  `EMPTY_DEV_FILTERS` (`site/market.js:339`) covers `query, place, work, publicInvolvement,
  cost, status, filed, since, off`.
- "Clear all" is hidden whenever nothing is active: `site/devmap.js:586` `clear.hidden = !active`,
  with `active = activeFilterCount(filters) + (hiringOnly ? 1 : 0)` (`:364`).
  `activeFilterCount` counts `off` and `since` (`site/market.js:405-410`), so legend
  hiding and a chart month both surface the escape hatch. Good.
- The legend and the chart are each excluded from their own input, so neither can trap
  the user: `site/devmap.js:338` `filterProjects(all, { ...filters, off: [] }, asOf)` and
  `:340` `filterProjects(all, { ...filters, since: '' }, asOf)`. The chart is a toggle —
  `:396-399` `since: filters.since === month ? '' : month`.
- Search is debounced but writes the query synchronously so a concurrent menu change
  cannot drop it: `site/devmap.js:204-209` (comment: "The query is kept at once").
  Commit `dbda09a` is specifically about that regression.
- Any change to the matching set refits the viewport: `show()` → `fit()`
  (`site/devmap.js:1010-1021`, `:972-978`), which `fitBounds` to the matches or, with
  none, `map.setView(CENTERS[city] ?? [31, -99], 9)`.

### Inferences
- **Bug (unexplainable empty result, reachable in two clicks).** Filter Austin by
  `Status = "Pending"`, then switch to El Paso. `filterProjects` runs with the stale
  status, returns 0, the list shows "No projects match these filters", and only then does
  `sync()` blank the Status pill. Final frame: zero results with every pill reading
  "All"/"Any" — the user cannot see what is filtering them, and the only recovery is the
  "Clear filters" link (which works, but on a filter set the UI claims is already empty).
  Fix: reconcile the pills against `filterChoices(all)` *before* computing `shown`
  (move the `sync()`/prune step to just after the `filtersCity !== city` block at
  `site/devmap.js:165-168`), or have `sync()` call `apply()` when it drops a value.
- **Bug (sort is not undoable via Clear).** `sort` survives `clearAll()` and the city
  change, but is not shown as an "active filter", so a user who set "Finishing" sees
  no indication and clearing does not restore "Biggest". Add `sort = 'biggest'` to
  `clearAll()`, or exclude sort from reset and say so — but pick one.
- **Design improvement.** Make the empty copy name the live constraints, built from
  `filters`: "No projects match: Cost $100M+, Hospitals hidden, filed since Mar 2025",
  each with its own one-click removal. The current generic hint actively misleads when
  the cause is the legend, the hiring toggle or the chart month.
- **Design improvement.** Refitting the viewport on every set change (`fit()` from
  `show()`) means each keystroke of a search re-zooms the map. `fit()` already has a
  `fitted` flag (`site/devmap.js:971,976`) that is only used for the first layout;
  consider refitting only on an explicit action (city change, Clear, a "Zoom to results"
  button) and leaving the user's pan alone otherwise.

### Gaps
- `node.dataset.matches` / `pins` / `drawn` / `specks` (`site/devmap.js:408, 958-961, 1019`)
  are instrumentation for the `devmap-check` skill; whether that check already covers the
  stale-status case needs a run of `.claude/skills/devmap-check`.

---

## Project list, legend, filing chart and detail panel — coherence

### Takeaway
The four surfaces are kept consistent for the three normal paths (row click, pin click,
panel prev/next), including on filter changes. The incoherences are at the edges: the
"speck" pins are not selectable at all, the panel silently closes when a filter excludes
the selection, and the smaller-filings list below the map is driven by the map's search
box without consent.

### Cited findings
- `select()` touches all four surfaces: row `active` class and `aria-current`
  (`site/devmap.js:422-428`), scrolls the row into the list viewport (`:429-432`),
  rebuilds the panel (`:433-434`), adds `panel-open` to the map wrap (`:435`) and marks
  the pin (`:436` → `api.select`, `:1030-1055`).
- `apply()` re-reconciles the selection after every filter change:
  `site/devmap.js:410-411` `if (selected && !ids.has(selected)) close(); else if (selected) step(0);`
  (`step(0)` re-renders the same project so prev/next stay in the new sort order —
  commit `0b43d2a`).
- `step()` walks `order`, which is the current sorted, filtered list
  (`site/devmap.js:341, 443-450`), so prev/next in the panel match the list order.
- Escape closes from anywhere in the card and returns focus to the row:
  `site/devmap.js:464-471`; `close()` also restores focus if it was inside the panel
  (`:460`).
- Legend click only toggles visibility: `site/devmap.js:227-232`. Its accessible name
  says so (`:218` "Categories: click one to hide or show it") but the pressed state is
  inverted relative to the action — `:392` `button.setAttribute('aria-pressed', String(!off.has(key)))`
  (pressed = *visible*, not "filter applied").
- Specks are painted on one canvas, not markers (`site/devmap.js:730-770`), and a click
  near one zooms instead of selecting: `site/devmap.js:780-784`
  `if (p) map.setView(where.get(p), Math.min(map.getZoom() + 2, SPREAD_ZOOM), …)`.
- Which projects become specks depends on pill overlap, biggest first; the selected
  project is always promoted to a pill: `site/devmap.js:928, 938`
  `(b === chosen) - (a === chosen) || (b.cost ?? 0) - (a.cost ?? 0)` and `if (p === chosen || free(box))`.
- The map search hijacks the smaller-filings search box: `site/devmap.js:402`
  `const more = filters.query ? reports.searchSmaller(filters.query) : 0;` and
  `site/devreports-view.js:102-106` `const searchFrom = (query) => { search.value = query; draw(); … }`.
- Smaller pins only appear when the *only* active filter is the query:
  `site/devmap.js:403-404` `const onlyQuery = activeFilterCount({ ...filters, query: '' }) === 0 && !hiringOnly;`
- "Show on map" in the smaller list is a no-op until the map finishes drawing:
  `site/devreports-view.js:40` `const opener = { open: () => false };`, replaced at
  `site/devmap.js:481` `reports.setOpenSmall((id) => drawn.openSmall(id));`.

### Inferences
- **Bug (keyboard and pointer dead end on specks).** In a metro with thousands of
  projects, most pins at the opening zoom are specks. A speck is on a canvas, so it has no
  focus, no tooltip, no accessible name, and clicking it only zooms by 2 — the user must
  click, wait for the fly, and hunt again. Keyboard users cannot reach any project through
  the map at all (only `pinFor` markers get `keyboard: true` and `onkeydown`,
  `site/devmap.js:710, 720`). The list is the only complete path. Minimum fix: make a
  speck click *select* the project (open the panel) as well as zoom, since `speckAt`
  already resolves it to a project.
- **Bug (stale smaller-filings results).** Type "hospital" in the map search, then clear
  it. `apply()` takes the `else 0` branch at `site/devmap.js:402`, so `searchSmaller` is
  never called, the hint hides — and the Smaller filings `<details>` below the map stays
  filtered to "hospital" with its own search box still containing the word. Clearing the
  map search should also clear the injected query (call `reports.searchSmaller('')`).
  Same class of problem: a query the user typed directly into the smaller-filings box is
  silently overwritten the next time any map filter changes.
- **Bug (map/hint disagree).** With `Cost = $50M+` plus a query, `more` is still computed
  and the hint still says "N more in Smaller filings below the map", but `showSmall(null)`
  removes every small pin because `onlyQuery` is false. Either suppress the hint too, or
  explain that smaller filings are not narrowed by the pills.
- **Design improvement.** When `apply()` closes the panel because the selection no longer
  matches (`site/devmap.js:410`), the project vanishes with no word. A one-line note in
  the panel ("Mercy Hospital no longer matches these filters — Show anyway") would keep
  the user oriented rather than making the filter feel destructive.
- **Design improvement.** Clicking a legend category is a hide-only affordance; the
  obvious reading of "click a category" is "show only this". Consider shift/alt or a
  second control for "only this", and switch the legend buttons to
  `aria-pressed = off.has(key)` with a label like "Hide Residential" so the pressed state
  matches the action.

### Gaps
- Whether the pill-vs-speck promotion makes the *selected* pin visually findable after a
  fly on a dense metro needs a run; the code guarantees a pill exists (`:938`) but not
  that it is inside the view after `flyTo`'s shift.

---

## Phone layout: panel sheet, search/list button, bottom tabs

### Takeaway
The phone workspace is carefully sized, but the JS and CSS disagree about where "narrow"
begins, the panel sheet covers more of the map than the fit padding assumes, and opening a
project hides the filters and the chart with no way back to them except closing the panel.

### Cited findings
- JS narrow threshold is the *map's own* width: `site/devmap.js:99-100`
  `/** Below this map width the project panel covers the lower part of the map … */ const NARROW_MAP = 820;`
  used by `const wide = () => node.clientWidth >= NARROW_MAP;` (`:847`) and toggled in the
  `ResizeObserver` (`:982` `wrap.classList.toggle('narrow', !wide())`).
- CSS stacks the layout at a *viewport* breakpoint of 900px
  (`site/style.css:8795-8827`) and applies the sheet geometry at 640px
  (`site/style.css:9050, 9080-9085` `.devx-mapwrap.narrow .devx-panel { top: 22%; … }`),
  with a base narrow rule at `top: 40%` (`site/style.css:8552-8559`).
- The panel's fly-shift assumes the sheet starts at 28% of the map height:
  `site/devmap.js:1051` `const shift = wide() ? L.point(Math.min(420, w * 0.45) / 2, 0) : L.point(0, h * 0.28);`
  and `fit()`'s padding assumes 62%: `site/devmap.js:856`
  `paddingBottomRight: [… , open && narrow ? h * 0.62 : …]`.
- Opening a project removes the filters and the chart on phones:
  `site/style.css:8561-8563`
  ```css
  .devx-mapwrap.narrow.panel-open .devx-filters,
  .devx-mapwrap.narrow.panel-open .devx-chart { display: none; }
  ```
- The "Search & project list" button is phone-only and ordered first in the head actions:
  `site/devmap.js:158-161`, `site/style.css:9720-9722` (`display: none` → `inline-flex`
  in the media query) and `:9747` `.devx-head-actions .devx-to-list { order: -1; }`.
  It scrolls the side region into view and focuses the input (`site/devmap.js:199-202`).
- Height is computed against the real bottom tabs rather than a constant:
  `site/devmap.js:495-506` reads `document.querySelector('nav.tabs')` and only acts when
  `document.body.dataset.workspace === 'map'` (set at `site/markets-view.js:218`);
  the CSS fallbacks subtract fixed numbers (`site/style.css:9044, 9062`), with
  `min-height: 380px` at ≤640.
- Page padding reserves the tab bar and the safe area: `site/style.css:9052`
  `padding: 8px 0 calc(72px + env(safe-area-inset-bottom, 0px));`, and the list has
  scroll padding above the tabs (commit `0b43d2a`).
- The filter pills become a horizontally scrolling row with a hidden scrollbar at ≤640
  (`site/style.css:8830-8838`) and the `More` popover is `position: fixed`
  (`:8840-8844`).

### Inferences
- **Bug (sheet overlaps the selected pin).** At ≤640 the sheet starts at 22% of the map
  (`site/style.css:9081`) but `select()` shifts the view by `h * 0.28`
  (`site/devmap.js:1051`), placing the pin at roughly 22% from the top — i.e. right under
  the sheet's top edge. `fit()`'s `h * 0.62` bottom padding (`:856`) is wrong by the same
  reasoning: 78% of the map is covered. Both constants should derive from the sheet's
  measured `getBoundingClientRect().top`, or at least match the CSS (0.78 / ~0.12).
- **Bug (breakpoint mismatch produces a mixed state).** Between ~640 and 900 CSS viewport
  width the body is stacked but the map is full-width, so `clientWidth` can exceed 820 and
  `narrow` stays false: the panel renders as a fixed 380px right-side card over a wide
  short map, while the sheet rules (`top: 22%`) never apply. Conversely with the list
  beside the map just under 900px the map's own width drops below 820 and `narrow`
  engages while the layout is still two-column, hiding the filters and chart on a desktop.
  Driving both from one container query, or exporting one threshold, removes the class.
- **Design improvement (phone filters are unreachable with a project open).** Closing the
  panel is the only way to adjust a filter. Either keep the pill row visible above the
  sheet (the sheet already starts 22% down) or give the sheet a collapsed "peek" state.
- **Design improvement.** The horizontally scrollable pill row has `scrollbar-width: none`
  (`site/style.css:8836`) with no fade or chevron, so `Funding`, `More`, `Firms hiring
  now` and `Clear all` are off-screen with nothing to suggest they exist. A right-edge
  gradient mask or a wrapped two-row layout would expose them.
- **Design improvement.** `.devx-to-list` ("Search & project list") sits at `order: -1`
  before the city menu and Follow button; "Filter" is arguably the more wanted phone
  action, and the same button could scroll back to the map afterwards (currently only the
  implicit `reveal` path at `site/devmap.js:438` returns the user to the map, and only
  when a row is picked).

### Gaps
- Whether `fitWorkspace`'s measured height and the CSS fallback ever disagree visibly
  (a flash on first paint) needs a device/emulator run; the observer fires only after
  layout (`site/devmap.js:980-987`).
- The bottom-tab overlap against iOS dynamic toolbars (`dvh` + `env(safe-area-inset-bottom)`)
  cannot be judged from code.

---

## Loading, empty, error and "no results" states

### Takeaway
The *map tile layer* has proper loading and error states. The *data* behind the map does
not: the background download of a metro's full project list has no indicator at all, its
failure is swallowed, and a map with zero matches looks identical to a map that simply has
no pins in view.

### Cited findings
- Map loading and error: `site/devmap.js:288`
  `mapNode.append(el('div', 'state dev-loading', 'Loading the map…'));` cleared by
  `node.replaceChildren()` at `:668`; failure replaced by
  `site/devmap.js:484-486` `mapNode.replaceChildren(stateBox(error … "Couldn't load the map.", 'error'))`,
  with the Leaflet loader resetting itself so a retry is possible (`:74-78`).
- The host's market-data states are all distinct: `site/markets-view.js:166`
  `message('Loading market data…', 'loading')`, `:174` "Market data is being built. Check
  back in a few minutes.", `:180` `Couldn't load market data. …`, and `:810-817`
  `mapMissing()` "No development projects in this build yet." with a way back.
- The per-metro full list is fetched in the background with **no UI**:
  `site/markets-view.js:851-864`. The status map is written and never read:
  `devFiles.set(city, 'loading')` (`:854`), `'done'` (`:860`), and the failure path is
  `.catch(() => devFiles.set(city, 'failed'))` (`:863`) — nothing renders from it.
  `devFiles` is only otherwise used as a de-dup guard (`:853`) and cleared on loader
  change (`:72`).
- A successful background load rebuilds the whole card: `site/markets-view.js:861` `render()`,
  and `render()` begins with `disposeMap()` (`:227`) then
  `$('m-body').replaceChildren(devMap(state.city || null, true) …)` (`:233`).
- "No results" in the list: `site/devmap.js:269-276` (the `dev-empty` row with "No
  projects match these filters." and a Clear filters link), shown by
  `:358` `empty.hidden = shown.length > 0 || !all.length;`.
- "No results" on the map: `fit()` falls back to the metro center with no message —
  `site/devmap.js:975` `else map.setView(CENTERS[city] ?? [31, -99], 9, { animate: false });`.
- The count is always live: `site/devmap.js:239-240` `count` with `aria-live="polite"`,
  and `:365-369` renders "N of M projects" plus a visually hidden pin count.
- Coverage is explained in prose below the map rather than in the empty state:
  `site/devmap.js:305-317` (the `dev-note` paragraph), ending with
  `: 'No projects to show yet.'` when the metro has nothing.

### Inferences
- **Bug (silent data truncation).** Between opening the map and the metro file landing,
  the user sees only the biggest projects from `market.json` — a plausible-looking but
  incomplete map, with the count ("412 projects") reading as authoritative. If the fetch
  fails, that truncated view is final and nothing says so. The `devFiles` statuses are
  already tracked; surface them: a "Loading the full list…" chip beside the count, and on
  `'failed'` a "Showing the biggest projects only — retry" row.
- **Bug (the background load destroys the user's work).** `render()` on line 861 disposes
  the Leaflet map and rebuilds the card, so a user who has already panned, zoomed, scrolled
  the list and opened a project loses the viewport, the list scroll and the open panel a
  few seconds after arriving. `filters` and `sort` survive (module globals) but `selected`
  does not (it is per-card, `site/devmap.js:323`). Either merge the new projects into the
  existing card, or carry the selection and viewport across the rebuild.
- **Bug (empty map is indistinguishable from an empty area).** With zero matches the map
  is a bare basemap at zoom 9. The list carries the explanation, but on phones the list is
  below the map and, with filters scrolled out of the pill row, the user may never see it.
  Add an overlay on the map itself ("No projects match these filters" + Clear) keyed off
  `mapNode.dataset.matches`, which `apply()` already sets (`site/devmap.js:408`).
- **Design improvement.** `empty.hidden = … || !all.length` deliberately suppresses the
  "no match" row when the metro has no projects at all, but then the list area is blank
  with no message — the explanation is in the `dev-note` paragraph far below
  (`site/devmap.js:317`). Show a distinct "This metro has no filed projects in this build
  yet." row in the list for that case.
- **Design improvement.** The hiring toggle depends on an independently loaded jobs feed
  (`hiringOn(project, growthJobs())`, `site/devmap.js:174-178`). If the feed is empty the
  toggle yields zero results with no explanation; the generic empty copy does not mention
  it. Disable the toggle, or say "no open roles in the feed yet".

### Gaps
- Whether `drawMap` can leave "Loading the map…" on screen permanently: it returns `null`
  when `!node.isConnected` (`site/devmap.js:666`) and `then` short-circuits on
  `if (!drawn) return;` (`:478`), which only happens after the card has left the page.
  Benign as far as the code shows, but worth a run with a slow `vendor/leaflet.js`.
- The `'Loading the map…'` node is also the only thing in `mapNode` before Leaflet
  attaches; whether the `ResizeObserver`/`fit()` first-layout path can race it needs a run.

---

## State loss on navigation and reload (summary of the deep-linking picture)

### Takeaway
Only `city` is addressable. Everything else is either a module global that survives
in-app navigation (and therefore leaks between cities) or per-card state that is lost on
any redraw — the worst of both: not shareable, not resettable.

### Cited findings
- Survives in-app navigation away and back, including to another city:
  `filters` minus `place` (`site/devmap.js:61, 165-168`), `sort` (`:106`),
  `hiringOnly` (`:108`), and `mapCity` in the host (`site/markets-view.js:50, 786-787, 795`).
- Lost on any redraw of the card: `selected` (`site/devmap.js:323`), `order` (`:322`),
  the map viewport, the list scroll, the `More` popover's open state, the Smaller filings
  `<details>` open state, and the dropped report pin (`site/devmap.js:820-826`).
- Lost on reload: everything but the hash's `city`/`tool` (`site/market.js:238-248`).
- Leaving the markets section tears the map down and drops the workspace class:
  `site/markets-view.js:159-162` and `:227`.

### Inferences
- A single `writeMapHash`-style extension to `site/market.js:238` plus a read in
  `developmentMap` would fix sharing, reload and the cross-city leak at once, and would
  make "Clear all" genuinely restore a known state. It would also let the entry cards link
  to a *clean* map (`site/markets-view.js:312, 841`) rather than inheriting whatever the
  user last did.

### Gaps
- I could not run the site, so every claim here is static. The three things I would most
  want to confirm on a device: the 22%/28%/62% sheet geometry at ≤640px; the stale-`status`
  zero-result frame when switching metros; and the card rebuild on
  `site/markets-view.js:861` landing mid-interaction. The repo ships a
  `devmap-check` skill (filters, loading, empty states) that is the right harness for the
  first two.
