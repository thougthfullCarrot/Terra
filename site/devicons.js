// devicons.js — the development map's category icons: one simple glyph per
// map category (site/market.js DEV_CATEGORIES), drawn white or dark on the
// category's color, so a category reads from its shape as well as its color.
// Used on the map pins, the legend and the project list.

/** 24×24 glyphs, filled with currentColor (Other is an outline). */
const GLYPHS = {
  // House.
  residential: '<path d="M12 3.5 2.5 11.6h2.8V20.5h5.2v-5.4h3v5.4h5.2v-8.9h2.8z"/>',
  // Office tower with windows.
  office: '<path fill-rule="evenodd" d="M6 2.5h12v19h-4v-3.5h-4v3.5H6zM8.4 5.5v2.2h2.6V5.5zm4.6 0v2.2h2.6V5.5zM8.4 9.6v2.2h2.6V9.6zm4.6 0v2.2h2.6V9.6zM8.4 13.7v2.2h2.6v-2.2zm4.6 0v2.2h2.6v-2.2z"/>',
  // Factory with saw-tooth roof and a stack.
  industrial: '<path d="M2.5 21V10.5l5.2 3.2v-3.2l5.2 3.2v-3.2l5 3.1V3h3.6v18z"/>',
  // Medical cross.
  healthcare: '<path d="M9.3 2.8h5.4v6.5h6.5v5.4h-6.5v6.5H9.3v-6.5H2.8V9.3h6.5z"/>',
  // Civic building: pediment, columns, base.
  public: '<path d="M12 2 2 7.2V9.4h20V7.2zM4 10.8h3.2v7.4H4zm6.4 0h3.2v7.4h-3.2zm6.4 0H20v7.4h-3.2zM2 19.6h20V22H2z"/>',
  // Storefront: scalloped awning over a shop with a door.
  retail: '<path d="M3.5 3h17l1.5 5.6c0 1.5-1.2 2.6-2.6 2.6-1.4 0-2.6-1.1-2.6-2.6 0 1.5-1.2 2.6-2.6 2.6S12 10.1 12 8.6c0 1.5-1.2 2.6-2.6 2.6S6.8 10.1 6.8 8.6c0 1.5-1.2 2.6-2.6 2.6S2 10.1 2 8.6zM4 12.8c.9.2 1.8.1 2.6-.3v.1c1.7.9 3.6.9 5.3 0 1.7.9 3.6.9 5.3 0 .8.4 1.8.5 2.8.3V21h-6v-5.2h-4V21H4z"/>',
  // Building outline.
  other: '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3h11v18h-11zM9.5 6.6h1.2m2.6 0h1.2M9.5 10.2h1.2m2.6 0h1.2M9.5 13.8h1.2m2.6 0h1.2M10.6 21v-3.2h2.8V21"/>'
};

/** Categories whose color is too light for a white glyph get a dark one. */
const DARK_GLYPH = new Set(['industrial', 'other']);

/** The glyph as an SVG string, for Leaflet's divIcon html. */
export function glyphSvg(key) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">${GLYPHS[key] ?? GLYPHS.other}</svg>`;
}

/** Class names that give an icon its category color and glyph color. */
export function categoryClass(key) {
  return `devx-cat devx-cat-${GLYPHS[key] ? key : 'other'}${DARK_GLYPH.has(key) || !GLYPHS[key] ? ' devx-glyph-dark' : ''}`;
}

/**
 * A small round category badge for the legend and the list. Labelled with
 * the category name when it stands alone; decorative when a label sits beside it.
 */
export function categoryBadge(cat, { label = true } = {}) {
  const badge = document.createElement('span');
  badge.className = `devx-badge ${categoryClass(cat?.key ?? 'other')}`;
  badge.style.setProperty('--cat', cat?.color ?? '#9b958d');
  badge.innerHTML = glyphSvg(cat?.key ?? 'other');
  if (label && cat?.label) {
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', cat.label);
    badge.title = cat.label;
  } else badge.setAttribute('aria-hidden', 'true');
  return badge;
}
