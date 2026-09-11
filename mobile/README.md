# Terra mobile

The five screens from the handoff, in React Native / Expo.

```
App.tsx              fonts, tab switching, the detail sheet overlay
src/
  theme/tokens.ts    the handoff's design tokens, translated to RN units
  state.ts           the whole client state, as one hook
  data/              the data contract: types, the seed source, the swap point
  components/        header, card, chips, segmented control, job card, states
  screens/           Feed, Market, Pipeline, Saved, Profile, DetailSheet
```

## Running it

```bash
npm install
npm start            # then press i for a simulator, or scan with Expo Go
npm run typecheck
npm run bundle       # metro bundle; catches what typecheck cannot
```

It runs against the prototype's seed data, so no backend is needed.

## Swapping in the real API

`src/data/source.ts` is the only file that knows where data comes from. Copy
`client/data-source.js` from the repo root into `src/data/` and change one
import — the signatures and shapes are identical, so no screen changes:

```ts
import * as impl from './live';   // was './seed.js'
```

`saved`, `apps` and `prefs` live in memory in `state.ts`. In production they
persist per profile in Postgres; that swap is in the hook, not in any screen.

## Notes on the translation

The prototype is HTML and some things do not carry over one-to-one:

- **Units.** CSS `letter-spacing` in em and `line-height` as a ratio are points
  here. The eyebrow's `.2em` on 9.5px is `letterSpacing: 1.9`.
- **The strong-match card.** The handoff's `0 2px 0 #2B4A8B, 0 3px 10px rgba(...)`
  is two box-shadows, which RN has no equivalent for. The solid 2px underline is
  a bottom border and the soft glow is the shadow.
- **No navigator.** The handoff specifies `tab` and `detail` as plain client
  state, so `App.tsx` switches on them directly. A router would only be
  something to override — the tab bar is custom and the sheet is an overlay,
  not a route.
- **Fonts are imported one face at a time.** Importing from
  `@expo-google-fonts/archivo` pulls every weight and italic of both families,
  about 2.8MB of fonts the design never uses.
- **No icon set.** Every tab mark is built from views, per the handoff's
  "all indicators are CSS shapes".

## Not verified

The app typechecks and bundles cleanly, which proves the module graph and the
types. It has **not been run on a device or a simulator**, so layout, font
rendering and the sheet animation are unconfirmed against the prototype. There
are no tests here yet; `src/state.ts` is where they would earn their keep
first — the feed filter, the re-tap-to-clear behaviour, and the apply/advance
transitions are the logic worth pinning.
