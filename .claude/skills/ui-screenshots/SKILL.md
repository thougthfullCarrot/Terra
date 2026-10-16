---
name: ui-screenshots
description: Take light and dark, desktop and phone screenshots of a Terra page or mockup with Playwright. Use to show a UI concept, a site change, or a before/after comparison.
---

# Screenshots of the site or a mockup

Uses Playwright with Chromium (free). In cloud sessions Chromium is already at `/opt/pw-browsers`; do not run `playwright install`. Elsewhere, `npx playwright-core install chromium` once.

Save this as a scratch script (outside the repo) and run it with `node shots.mjs <url-or-file> <out-dir>`:

```js
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [target, out = 'shots'] = process.argv.slice(2);
const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();
for (const [name, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true });
    if (errors.length) console.log(`${name}-${scheme} errors:`, errors);
    await page.close();
  }
}
await browser.close();
```

Run it from `backend/` (it has `playwright-core` installed) or install `playwright-core` in your scratch folder.

Notes:
- For the real site locally: build it (`site-build-and-test` skill), serve with `python3 -m http.server -d site 8080`, then shoot `http://localhost:8080/`.
- For the live site use https://thougthfullcarrot.github.io/Terra/. Account-only screens need a test account; never use Rod's real account.
- Check phone shots for horizontal scroll and cut-off text, and dark shots for unreadable text.
- Put images under `/mnt/project-files/<topic>/` and attach them in the reply, named like `desktop-light.png`.
