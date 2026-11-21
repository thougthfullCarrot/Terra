# Reference-site findings for the TERRA redesign

Captured 2026-11-21 with headless Chromium (Playwright) from this cloud environment.
Viewports: desktop 1440×900 and phone 390×844, both at deviceScaleFactor 1.
Raw measurements are in each site's `measurements*.json` file. The scripts used are in `scripts/`.

**Read this first: how much each site could be observed**

| Site | Live render in Chromium | What was captured |
|---|---|---|
| semianalysis.com | **Blocked.** HTTP 403 with a "Checking your browser…" page and a **"Confirm you are human"** checkbox, at both viewports. | Screenshot of the bot wall, plus **static HTML** from a plain HTTP GET (200 OK). No visual, motion or computed-style observations. |
| amd.com | **Failed.** Every Chromium request returned HTTP 502 `upstream request failed` from the environment's egress proxy (no AMD server headers). A plain HTTP GET with curl returned 200. It was retried 3 times. | Screenshot of the error, plus **static HTML**. No visual, motion or computed-style observations. |
| spacex.com | **Partial.** The page shell loads, but the homepage's content APIs on `content.spacex.com` failed with `net::ERR_TUNNEL_CONNECTION_FAILED` because that host is not on this environment's allowlist. The homepage renders as black space with the header and footer only. | Homepage header, nav, dropdowns and phone menu. The **Human Spaceflight page** (`/humanspaceflight`) rendered fully and is captured as a stand-in for SpaceX's page language, labelled as such. |
| palantir.com | **Full**, except the hero video. | Everything. The hero `<video>` reports `readyState 4`, playing, with H.264 supported, yet it paints black in headless screenshots. Inferred: headless video compositing, not the site. |

Nothing below is filled in from memory. Where something could not be observed, the text says so.

---

## 1. SemiAnalysis: semianalysis.com

### Observed
- **Access:** both viewports showed a centred "Confirm you are human" page ("We need to check you're not a robot before you can enter this site.") with an "I am human" checkbox. Page title: "Checking your browser…". The checkbox was not clicked, because getting past bot checks is out of scope. Files: `semianalysis/desktop-01.png`, `phone-01.png`.
- **Static HTML (curl, 200)**:
  - Title: "SemiAnalysis | AI and Semiconductor Research, Models, Advisory".
  - Meta description: "Independent research on the AI and semiconductor supply chain. Read by 318,000+ subscribers. Fourteen institutional models, open benchmarks, and advisory."
  - **Top-level nav, verbatim, in source order:** `Models & Research` (button) · `Tools` (button) · `About` · `Archives` · `Careers` · `Events` · `Newsletter` · `Institutional Login` (button).
  - **Models & Research mega-menu:** Accelerator & HBM, Datacenter Industry, AI Cloud & TCO, AI Networking, Wafer Fab Equipment, Tokenomics Model, Core Research, Memory Model, Energy Model, Foundry Industry, China Datacenter, Industrials Model, ChipBook, Cache Up, Space DC TCO Model, Compute Capital & Markets, Consulting, View all models. It also has two promo tiles: "New · STEEL Lab: Teardowns from product to transistor" and "Core Research: Weekly and ad hoc institutional analysis on AI and semiconductors".
  - **Tools mega-menu**, in three labelled groups:
    - *Tools:* Die Yield Calculator, Fab Map, Inference Simulator.
    - *Benchmarks & Indexes:* InferenceX, GDPx (New), ClusterMAX, GPU Pricing Index.
    - *API:* Model API, GPU Pricing API, Research API, API Documentation.
    - Promo tiles: "New · GDPx: The general agentic benchmark" and "Open source · InferenceX: The open standard for inference benchmarks".
  - **Homepage text in source order:**
    - H1 "SemiAnalysis", with the eyebrow "Independent AI and semiconductor research".
    - Tagline: "The definitive source on the world's most important industry."
    - "The #1 technology newsletter on Substack".
    - A tabbed product block: Accelerator & HBM Model · Datacenter Industry Model · Tokenomics Model · OSS Tooling & Benchmarks ("Transparency is trust.") · Consulting ("Engage the best.") · API Access ("Programmatic Semiconductor Data").
    - Each product panel has a long description, "View model / Talk to Sales" buttons, and a row of spec facts. For example, Datacenter Industry Model: "Capacity model 6,500+ structures · Power draw Per structure, planned vs operational · Site strategy Region by region · Delivery tracking Promised vs delivered MW, quarterly · Coverage Buildouts through 2030".
    - H2s: "What's your email?", "SemiAnalysis Institutional Login", "Filter" (a filterable article list, inferred from the "Filter" heading).
  - **Fonts declared:** `--wp--preset--font-family--grift: "Grift"` and `--wp--preset--font-family--inter: "Inter"`. Preloaded files: `Grift-Black.woff2`, `Outfit-Variable-latin.woff2`, `JetBrainsMono-Variable-latin.woff2`.
  - **Type scale (WordPress presets):**
    - h-1: clamp(32px … 96px)
    - h-2: clamp(24px … 48px)
    - h-3: clamp(22px … 40px)
    - h-4: clamp(20px … 32px)
    - h-5: clamp(18px … 24px)
    - h-6: clamp(16px … 18px)
    - body: 16–18px; tiny: 14px.
  - **Colour tokens:**
    - base `#17191B` (page background), contrast `#EAEBEC` (text)
    - **primary `#F7B041`** (amber), **secondary `#0B86D1`** (blue), tertiary `#F6F6F6`
    - neutral ramp: 100 `#CFD2D4`, 200 `#B4B9BC`, 300 `#999EA4`, 400 `#7E848C`, 500 `#656B72`, 600 `#4D5157`, 700 `#35383C`, 800 `#242628`, 950 `#131416`
    - per-product accents (`--sahc-accent`): `#0092FF`, `#0B86D1`, `#26C9D8`, `#2EAD8E`, `#F7B041`, `#E8E4DD`, each paired with a ~14% alpha "soft" version.
  - **Build:** WordPress block theme, with Complianz cookie consent (`complianz-gdpr-premium`) and a stylesheet named `hero-claude.css`.

### Inferred, not seen
- The tokens (`base #17191B` as background, light `contrast` text) indicate a **dark theme** with amber and blue accents. This was not visually confirmed.
- Grift Black is likely the display face, Inter or Outfit the UI and body face, and JetBrains Mono the data and numbers face. These are preloads only; the computed usage was not measured.
- A cookie banner probably appears for EU visitors (Complianz). It was not seen.

### Relevance to TERRA (from the static evidence)
- **A research brand whose products are its data models.** Each model gets a tab with a one-line value statement, a dense paragraph, "View model / Talk to Sales" buttons, and a 5-item spec strip ("Coverage: Forecasts to 2030, history to 2021"). TERRA's datasets (permits, comps, ownership, dev pipeline) could be presented the same way.
- **The Tools nav is grouped into Tools, Benchmarks & Indexes, and API.** That maps onto TERRA's calculators and maps, market indices, and data access.
- **Trust numbers in the meta description** ("318,000+ subscribers", "Fourteen institutional models").
- **The token system is a good template:** one near-black base, one warm accent and one cool accent, a 9-step neutral ramp, and a soft-alpha tint per product.

---

## 2. AMD: amd.com/en.html

### Observed
- **Access:** Chromium received `502 upstream request failed`, `content-type: text/plain`, with no AMD headers, on all attempts. The proxy logged no specific reason. curl through the same proxy got `HTTP/2 200`. Files: `amd/desktop-01.png`, `phone-01.png` show the error text. **AMD's live page could not be observed visually.**
- **Static HTML (curl, 200)**:
  - Title: "AMD ׀ together we advance_AI".
  - **Top-level nav, verbatim:** `Products` · `Solutions` · `Resources & Support` · `Shop` · `My Account` · `EN`.
  - **Second-level mega-menu categories** (buttons with a chevron-right icon): Processors · Accelerators · Graphics · Adaptive SoCs, FPGAs, & SOMs · Software, Tools, & Apps · AI · Industries · Workloads · Gaming · Downloads · Developer Resources · Partner Resources · Support · Shop AMD.
  - **Third level, example under Processors:** EPYC CPU Portfolio, Data Center Cloud & AI, Network & Edge, Small Business & Hosting, Server CPU Specifications, Ryzen PRO Laptops/Desktops, Workstations, PRO Technologies, Ryzen AI for Business, Ryzen Laptops/Desktops, Advantage Gaming Laptops/Desktops, Ryzen Z Series Handhelds, Ryzen AI for Consumer, EPYC and Ryzen, Partner Directory, Product Specifications, Enterprise Blogs & Insights.
  - **Homepage sections from headings:**
    - H1 "Your Trusted Partner for Advancing AI"
    - news H3s: "AMD Completes Acquisition of Taalas to Advance AI Inference Innovation", "AMD Completes Acquisition of World Labs", "AMD Showcases 6th Gen AMD EPYC Processors"
    - H2 "Why AMD", with H3s "Broadest Portfolio of AI Solutions", "Open Ecosystem Approach", "Proven Leadership in Innovation"
    - H2 "Leading Businesses Trust AMD"
    - H2 "A Comprehensive AI Portfolio", with H3s "Data Center AI", "Edge AI", "AI PCs"
    - H2 "Developer Central", with H3s "AMD ROCm™ Software", "AMD Silo AI"
    - H2 "Latest News"
  - **Build:** Adobe Experience Manager (`/etc.clientlibs/…`), Coveo Atomic search (`coveo.css` v3.64.1), Font Awesome Sharp, and **OneTrust/TrustArc** consent scripts.
- Fonts and colours are not in the HTML; they live in external CSS that was not evaluated. **No font or colour values are recorded for AMD.**

### Inferred, not seen
- The hero area appears to carry 3 news items next to the H1, judging by the H3s that come right after it in source order.
- A consent banner probably shows on first visit (OneTrust/TrustArc scripts present).

### Relevance to TERRA
- **A three-level mega-menu for a very large catalogue:** top category, then a column of category buttons with chevrons, then a link list. It is useful only if TERRA's IA grows past ~25 destinations.
- **A homepage arc for an enterprise buyer:** claim, then proof (Why AMD, three pillars), then logos ("Leading Businesses Trust AMD"), then portfolio by segment, then developer resources, then news.
- **A dedicated search provider (Coveo)** in the header, a signal that search is a primary nav tool on large sites.

---

## 3. SpaceX: spacex.com

> The homepage's content tiles come from `content.spacex.com`, which this environment blocks, so the homepage body could not be observed. These requests failed: `/api/spacex-website/homepage-tiles`, `/media/featured-home`, `/featured-launch-tiles`, `/launches-page-tiles/upcoming`, `/pad-photos` and `/cms-assets/future_missions.json`. The first scroll pass accidentally followed a nav link to **`/humanspaceflight`**. Those 10 shots are saved as `humanspaceflight-desktop-NN.png` and serve as the observed sample of SpaceX's page language. `desktop-01/02.png` and `phone-*.png` are the real homepage: black, with header and footer only.

### Observed: visual identity
- **Pure black canvas.** `body` background is `rgb(0,0,0)`, with off-white text `rgb(240,240,250)` that has a slight blue cast.
- **There is no accent colour.** The page is black, white and photography.
- **Full-bleed photography of real hardware and astronauts.** Sections alternate between image-dominant and text-dominant.
- **Readability over photos comes from gradient scrims:**
  - `linear-gradient(rgba(0,0,0,.75) 0% → .55 35% → .25 70% → 0 100%)`
  - `linear-gradient(rgba(0,0,0,.5) → 0)`
  - `linear-gradient(rgba(0,0,0,.6) 0% → 0 95%)`
- **Colour tokens on `:root`:** an opacity ramp of one white, `--white-100 … --white-10` = `rgba(240,240,250, 1 / .9 / .8 / .7 / .6 / .5 / .35 / .3 / .15 / .1)`, plus `--black-50/80` and `--gray-80/60/40` = `rgba(37,38,40, .8/.6/.4)`.

### Observed: layout of `/humanspaceflight`, top to bottom
1. Full-screen photo hero: **"HUMAN SPACEFLIGHT"**, very large, bold, uppercase and centred, with the sub-line "MAKING LIFE MULTIPLANETARY".
2. Media carousel of video and audio tiles, **"ON-ORBIT"** and **"LAUNCH"**. It has an inline audio player, left/right arrows and dot pagination. Its frame did not change over 6 s with no input, so it **does not autoplay**.
3. **"DESTINATIONS"**: a white line-art orbital diagram with labels SPACE STATION, EARTH ORBIT, MOON, MARS.
4. **"OUR MISSIONS"**:
   - A tab row: MOON · MARS · EARTH ORBIT · SPACE STATION.
   - A **spec table** with hairline dividers: Mission Duration "7 days", Altitude "384,400 km from Earth", Seating "Up to 12 passengers, with private quarters", Volume "1,000 m³".
   - A "JOIN A MISSION" button.
5. **"THE SUITS"**: tabs INTRAVEHICULAR ACTIVITY (IVA) | EXTRAVEHICULAR ACTIVITY (EVA), over a studio-lit suit image.
6. **"THE VEHICLES"**: "DRAGON" and "STARSHIP" blocks, each with a product render, a paragraph and a "LEARN MORE" button.
7. **"DEVELOP YOUR RESEARCH"**: a launch photo with a paragraph.
8. **"THE ROAD TO MAKING HUMANITY MULTIPLANETARY"**: a horizontal **timeline carousel** of photo cards (2008, 2010, 2012…) with arrows and about 12 dots.
9. Footer, one row: CAREERS · UPDATES · PRIVACY POLICY · SUPPLIERS · INVESTORS · © 2026 SPACEX · X icon.

### Observed: navigation
- **Desktop header:** a `div.header` with `position: fixed`, **74px** tall and **transparent** (`background: rgba(0,0,0,0)`, no backdrop blur) over the hero.
  - **Hide-on-scroll:** at scrollY 400 and 1200 the header's `opacity` was `0`. After scrolling up 300px it went back to `1`.
- **Top-level labels, verbatim:** `VEHICLES` · `HUMAN SPACEFLIGHT` · `STARLINK` · `STARSHIELD` · `SPACEXSI` · `TERAFAB` · `COMPANY` · `SHOP`. The SPACEX wordmark is on the left.
- **Dropdowns on hover** are plain text lists with no panel background, and the label gains a ▾ chevron. Screenshots: `desktop-hover-vehicles.png`, `-human-spaceflight.png`, `-company.png`.
  - VEHICLES → STARSHIP, DRAGON, FALCON 9, FALCON HEAVY, STARFALL
  - HUMAN SPACEFLIGHT → OVERVIEW, SPACE STATION, EARTH ORBIT, THE MOON, MARS & BEYOND
  - COMPANY → MISSION, CAREERS, SITES, UPDATES, CONTENT, INVESTORS
  - Other links in the DOM: STARLINK, STARSHIELD, STARMIND, GROK, GROKIPEDIA, 𝕏, TERAFAB.
- **Phone:** wordmark at left, hamburger (`div.header-button`) at right. The menu (`phone-menu.png`) is a **full-screen black overlay** with a stacked uppercase list: VEHICLES ▾ · HUMAN SPACEFLIGHT ▾ · STARLINK · STARSHIELD · SPACEXSI ▾ · TERAFAB · COMPANY ▾ · SHOP ▾, and a × close button at top right.

### Observed: typography
- **One family: `D-DIN`** (fallback Arial, Verdana). Only `D-DIN 400 normal` showed as loaded, and bold weights are rendered at 700.
- **Nav:** 13px, weight 700, **uppercase**, letter-spacing ≈1.17px (0.09em), colour `rgba(240,240,250,.9)`.
- **Body paragraphs:** 16px / 26px, weight 400.
- **Buttons ("LEARN MORE"):** 16px, weight 400, `1px solid rgba(240,240,250,.35)` border, **4px radius**, `0 20px` padding, transparent fill (ghost button).
- **Section titles** are uppercase bold D-DIN. The hero title is visually about 90–100px at 1440 wide; this is an estimate, as the title element was not isolated for measurement.

### Observed: motion and interaction
- Header hides on scroll down and shows on scroll up. It stays transparent throughout.
- The carousels (media tiles, timeline) are **manual**: arrows and dots, no autoplay.
- Tabs switch content in place (missions, suits).
- The automated probe found no scroll-triggered opacity reveals and no transform changes (0 and 0).
- No `<video>` elements were found on the homepage (its content was blocked). The media tile on `/humanspaceflight` shows a ▶ play affordance.
- No animation libraries were detected: no GSAP, Lenis, Swiper, AOS or Framer globals or markers.

### Strengths
- Restraint: one typeface, one text colour at stepped opacities, black, and photography. Hierarchy comes from size and case, not colour.
- A **spec table with hairline rules** turns mission facts into scannable data.
- A transparent, hide-on-scroll header gives the imagery the whole screen.

### Ideas for a CRE intelligence platform
- **The spec-strip and spec-table pattern for property or market facts.** For example: Building SF · Year Built · Occupancy · Asking Rent, laid out as label left, value right, with hairline dividers.
- **Tabbed in-place comparisons** (MOON / MARS / EARTH ORBIT) are the same pattern TERRA could use for submarket, property type or time period.
- **An opacity-ramp colour system** (`--white-100…10`) is a compact way to build a dark-mode UI without many greys.
- **A timeline carousel** suits a property's or submarket's history (permits, sales, delivery dates).
- **Caution:** a hide-on-scroll header is wrong for an app where nav and search must stay reachable. Inferred.

---

## 4. Palantir: palantir.com

### Observed: visual identity
- **A light-grey editorial site with dark feature cards.** `body` background is `#fff`, and the largest background areas are `rgb(239,239,239)` and `rgb(243,243,243)`. There are dark panels in `rgb(30,33,36)` (`#1E2124`), `rgb(13,14,16)` and `rgb(32,36,38)`.
- **Text colours:** primary `#1E2124`, secondary grey `rgb(102,102,102)` (the most-used text colour by character count), and white on dark cards.
- **CSS custom properties:**
  - `--accent-color: #2b5945` (dark green), `--accent10-color: rgba(43,89,69,.1)`, `--accent05-color`, `--accent05-opaque-color: #f4f7f6`
  - `--text-color: #1e2124`, `--text-color-medium: #636363`, `--text-color-light: #767676`
  - `--body-color: #fff`, `--body-color-medium: #f3f3f3`, `--body-color-light: #f9f9f9`
  - `--error-color: #ff4136`
  - The accent green was not seen prominently on the homepage.
- **Announcement bar:** `rgb(30,31,43)`, 53px tall, with the text "Read CEO Alex Karp's Letter to Shareholders" and a × close.
- **Hero:** a full-viewport looping, muted background video (`PAL_HEADER_LOOP_Desktop_V2.2.mp4`; a separate `…_Mob` file on phone) with a **Pause background video** control at bottom right and a ↓ scroll cue at bottom centre. It paints black in headless capture; see the access note at the top.
- **The H1 is visually hidden:** "Sovereign AI Systems for Every Decision", 1×1px with `clip-path: inset(50%)`. The hero shows no on-screen headline in the DOM.

### Observed: layout, top to bottom (desktop)
1. Announcement bar.
2. A floating, inset header bar (see Navigation).
3. Full-screen video hero.
4. **Featured carousel with a tab strip:** ShipOS · Warp Speed · Systems Migration · DevCon 6 · AIPCon 11 · Interoperability · Maven Smart System · TITAN · Chain Reaction · SEE ALL.
   - Dark cards with an eyebrow (e.g. "SYSTEMS MIGRATION") and an H3, e.g. "Accelerate Enterprise Data Migration with Palantir AIP ↗".
   - One card holds an animated demo graphic: "TRADITIONAL SYSTEMS MIGRATION", a progress bar reading "PROGRESS: LOADING…", then "WITH PALANTIR AIP" in purple.
   - Other H3s: "Rebuilding American Sea Power", "The Manufacturing OS for American Re-Industrialization", "Building the Agent Stack, the Ontology-Powered Infrastructure Behind Agents That Work at Scale", "How Foundry and AIP Create Excellence in Execution…", "Activate AI. With Any Storage. Any Compute. Any Model. Anywhere", "AI Is Transforming the Battlefield", "The New ISV TITAN. Designed and Delivered in 90 Days", "The Operating System for American AI Infrastructure".
   - Has ← → arrow buttons.
5. **Statement:** "Our software powers real-time, AI-driven decisions in critical government and commercial enterprises in the West, from the factory floors to the front lines." It is large, centred and grey, and in both captures part of the sentence ("AI-driven") was a lighter grey than the rest.
6. **Platform index:** a numbered list with huge names and a one-line description each, with numbers /0.1 to /0.5 at the right edge.
   - **AIP**: "Automate operations, from the factory floor to the front lines"
   - **Gotham**: "Achieve AI-driven combat superiority, from space to mud"
   - **Foundry**: "Build and manage Ontology-powered software, with a complete developer platform"
   - **Ontology**: "The central system for orchestrating decisions across Human+AI teams"
   - **Apollo**: "Autonomously deploy, monitor, and manage software across any environment"
   - Each row has a hidden per-platform video (`homepage_-_AIP.mov`, `…Gotham`, `…Foundry`, `Ontology.mov`, `…Apollo`). They stayed paused at 0×0 in the test; see Motion.
7. **Careers card:** a photo with "There is so much left to build / Palantirians deliver mission-critical outcomes for the West's most important institutions." and a LEARN MORE button.
8. **"What our partners say about …"**: a horizontal carousel of quote cards from PAREXEL, HEINEKEN, WALGREENS and L3HARRIS. On phone, "WENDY'S QUALITY SUPPLY CHAIN CO-OP" also appears, with a named attribution: "Pete Suerken, President & CEO".
9. **Two giant CTA blocks:** **"Request a Demo →"** (light grey) and **"Start Building →"** (near-black).
10. **Footer:**
    - © 2026 Palantir Technologies Inc., Cookie Settings, a US · UK · JP switch, and pill buttons YOUTUBE · X · LINKEDIN · GITHUB · STORE.
    - Four dense link columns: OFFERINGS (industries), IMPACT STUDIES (customers), CAPABILITIES, DOCUMENTS.

### Observed: navigation
- **The desktop header is a floating rounded bar** inset from the edges (`headerBg`, 70px tall, `background: rgba(171,171,171,.1)`, `backdrop-filter: blur(10px)`).
  - Contents: Palantir wordmark at left; **Get Started** (outlined) at right; then a **search** icon button and a **menu** (hamburger) icon button.
  - It is sticky (`position: sticky`, z-index 600). After scrolling, it sits 16px from the top (`desktop-scrolled-header.png`).
  - **There are no visible nav labels.** Navigation is entirely behind the menu button.
- **The menu opens a full-screen dark mega-overlay** (`desktop-menu-open.png`, background ≈`#1E2124`) with four columns:
  - **NAVIGATION** (34px links): Sovereign AI · ↳ AIP · ↳ Foundry · ↳ Gotham · ↳ Ontology · ↳ Apollo · Offerings · Impact Studies · Documentation · Careers · Newsroom · Palantir Explained.
  - **LATEST NEWS:** two news cards with thumbnails, source and date ("THE TIMES, JUNE 9, 2026", "CNBC, JULY 1, 2026"), and ↳ Read Here / ↳ Watch Here links.
  - **OFFERINGS:** a blurb and "↳ Learn more about AIP".
  - **LATEST IMPACT and QUICK LINKS:** About Palantir, Blog, Investor Relations, Letters from the CEO, Privacy & Civil Liberties, Information Security, Cloud Partners, Palantir Learning, …
  - Column headers are 10px uppercase in `rgb(185,185,185)`.
  - **Hovering a menu link dims it to grey** (`desktop-menu-hover-offerings.png`).
- **Search overlay:** a "Start typing to search" field with **POPULAR SEARCHES**: Foundry, Gotham, Apollo, Ontology, Artificial Intelligence (AI) (`phone-search.png`).
- **Phone:** the header carries only the wordmark. **The controls move to a fixed bottom bar:** ☰ menu and ⌕ search at bottom left, **Get Started** at bottom right. The menu is the same content as desktop, stacked in one scrolling column (`phone-menu.png`, `phone-menu-2.png`).

### Observed: typography
- **`Alliance No.1`** carries body, headings and nav. **`Alliance No.2`** is used for small uppercase labels. Both loaded at weight 400 only, and **every measured element is weight 400**: hierarchy comes from size alone.
- Body: 18px. News paragraphs: 16px / 22.9px.
- Card H3s: **34px / 36px, letter-spacing −1.7px (−0.05em)**. On phone the same H3s are 18px / 22px, −0.9px.
- Menu links: 34px / 40px.
- Section and column labels: **10px / 16px, uppercase, letter-spacing 0.5px**, Alliance No.2, grey `rgb(185,185,185)`.
- Carousel arrows are text glyphs (← →) at 30px.
- The ↳ and ↗ glyphs are used throughout as link markers.
- Platform names (AIP, Gotham…) are visually about 70px. This is an estimate; it was not isolated.

### Observed: motion and interaction
- Background **video loop** in the hero, with a user **pause** control.
- **Scroll-triggered reveals:** 8 elements below the fold went from opacity < 0.5 to > 0.9 after scrolling, at both viewports.
- **Sticky header** that stays reachable. **Carousels** with arrow buttons and a tab strip (1 carousel container detected).
- The per-platform videos exist but stayed paused when a platform row was hovered (`desktop-platform-hover.png` vs `-rest.png`; no visible change). How they trigger was not determined.
- The CTA "Get Started" hover was captured (`desktop-hover-get-started.png`).
- The impact-study card showed no style change on hover (0 changed elements).
- Built with Next.js. Class prefix `ptcom-design__…`.

### Strengths
- **Navigation as content:** the menu overlay doubles as a news and impact digest.
- **Mobile thumb-zone controls:** menu, search and the primary CTA sit at the bottom of the screen.
- **Calm typographic system:** one weight, tight negative tracking on large sizes, 10px uppercase labels, and arrow glyphs as link affordances.
- **Proof-driven:** named customer quotes, impact studies, dated press items.

### Ideas for a CRE intelligence platform
- **A numbered "platform index"** (/0.1 AIP …) could list TERRA's modules (Comps, Permits / Dev Pipeline, Ownership, Market Reports) in large type with one-line outcomes.
- **A bottom action bar on phone** for Search, Menu and a primary CTA ("Request access" or "Search a property").
- **A search overlay with popular searches.** For CRE these could be submarkets and counties ("Austin CBD", "Harris County industrial"), property types, or recent deals.
- **The menu as a digest:** latest market notes and recent deals inside the menu panel.
- **A dual CTA ending** ("Request a Demo" / "Start Building") maps to TERRA's "Talk to us" / "Explore the map".
- **10px uppercase grey section labels** over dense content mean less visual weight than coloured headers.

---

## Cross-site patterns (inferred from the observations above)

| Pattern | Where observed | Use for TERRA |
|---|---|---|
| Dark, near-monochrome base with photography or data doing the colour work | SpaceX (black and `#F0F0FA`); SemiAnalysis tokens (`#17191B`, unconfirmed visually) | A dark map and data UI with one warm accent |
| Data models and tools as first-class nav ("Models & Research", "Tools / Benchmarks & Indexes / API") | SemiAnalysis (static) | IA: Data · Tools · Indexes · API |
| Spec strips and spec tables (label and value, hairlines) | SpaceX missions; SemiAnalysis product panels (static) | Property and submarket fact panels |
| Numbered product index in large type | Palantir | Module overview |
| Full-screen overlay menu with secondary content | Palantir (dark mega-overlay), SpaceX phone | A menu showing recent deals and reports |
| Phone controls in a bottom bar | Palantir | Search-first mobile |
| Single-weight or single-family typography; hierarchy by size, case and tracking | Palantir (Alliance, weight 400), SpaceX (D-DIN uppercase) | Fewer weights, stronger scale |
| Manual carousels with arrows and dots, no autoplay | SpaceX, Palantir | Fine for case studies; avoid for core data |

## Files
- `<site>/desktop-NN.png`, `phone-NN.png`: scroll captures about every 900px, at most 10 per viewport.
- `spacex/humanspaceflight-desktop-NN.png`: the SpaceX subpage. The homepage body could not load here.
- `*-hover-*.png`, `*-menu*.png`, `*-search-open.png` / `phone-search.png`, `*-click-*.png`: nav states. `palantir/desktop-click-button.png` shows the announcement bar dismissed, which was an accidental click and is kept for honesty.
- `palantir/desktop-hero-{a,b,c}.png` (hero at about 3, 8 and 14 s), `desktop-scrollseq-N.png`, `desktop-platform-{rest,hover}.png`.
- `measurements.json` (first pass), `measurements-pass2.json` / `-pass3.json` (targeted re-checks), `spacex/measurements-type.txt`.
  - Note: the SpaceX `measurements.json` `desktop` block is the homepage, but its `desktopScroll` shots were taken on `/humanspaceflight` (see above).
- `scripts/`: the Playwright scripts used.

## How to complete the gaps
- **SpaceX homepage:** allow `content.spacex.com` in the environment's network settings, then re-run `scripts/capture.js spacex https://www.spacex.com/ research/reference-sites`.
- **AMD:** Chromium traffic through the egress proxy fails while curl succeeds. A capture from a normal desktop browser, or from a different network, is needed.
- **SemiAnalysis:** it shows a human-verification wall to automated browsers. A manual capture by a person is the appropriate route.
