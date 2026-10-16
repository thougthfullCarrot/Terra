---
name: ui-mockup
description: Make a new UI concept or mockup for the Terra website as a plain HTML page using the site's real colors, fonts and components. Use when Rod asks for a new screen idea, redesign concept, or mockup.
---

# Terra UI concepts and mockups

Rod prefers "current, polished" over bold redesigns: new concepts should feel like the live site, improved, not a different brand.

## Output
- One self-contained **plain HTML** file per concept (inline CSS, no build step). Design-canvas artifacts have rendered blank for Rod before; plain HTML works.
- Save concepts under `/mnt/project-files/mockups/<concept-name>/` (not in the repo) unless Rod asks to build it for real.
- Offer 2 or 3 variations side by side when the brief is open, each labeled with what is different.
- Free tools only: Google Fonts, no paid icon sets or design tools.

## Use the site's real design tokens
Copy the `:root` token block (light plus both dark-mode blocks) from `site/style.css` rather than retyping values, so mockups stay in sync. Key values today:
- Background `--bg #f4f2ee`, cards `--surface #fff`, text `--ink #17191a`, muted `--muted #6b6b63`
- Accent `--accent #2b4a8b` (hover `#26314a`, tint `#e3e8f3`); status red `#b8442e`, green `#276b42`, amber `#b8722e`
- Fonts: `--ui` Archivo for everything, `--mono` JetBrains Mono for numbers, prices and data
- `--radius 14px`, soft shadows (`--shadow-sm/md/lg`), hairline borders
- Dark mode: `@media (prefers-color-scheme: dark)` on `:root:not([data-theme='light'])` plus `:root[data-theme='dark']`. Every mockup must work in both.

Reuse existing patterns before inventing new ones: look at `site/index.html` and the matching section of `site/style.css` (job cards, chips, split job view, phone bottom tabs, market charts, dev map panel).

## Content
- Use realistic Texas CRE data (e.g. "Analyst, Acquisitions, Dallas, 0-2 yrs"), never lorem ipsum.
- Design the phone layout (390px wide) as well as desktop (1440px). No horizontal scroll on phone, 16px side gutter.
- Include empty, loading and error states when the screen has them.

## Hand-off
Screenshot every concept with the `ui-screenshots` skill (light and dark, desktop and phone) and share the images with a short note on what changed from the live site. Only turn a concept into real site code after Rod picks one.
