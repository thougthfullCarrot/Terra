/**
 * Design tokens from the handoff. These values are final — colors, type,
 * spacing and copy were signed off on the prototype, so nothing here should be
 * adjusted to taste.
 *
 * Two translations from the CSS original are worth knowing about:
 *  · letter-spacing is in points, not em. The handoff's `.2em` on a 9.5px
 *    eyebrow is 1.9pt here.
 *  · line-height is in points, not a ratio. `28px / 1.1` is 31.
 */

export const color = {
  bg: '#F4F2EE',
  surface: '#FFFFFF',

  ink: '#17191A',
  secondary: '#3A3A35',
  muted: '#6B6B63',
  faint: '#8A867C',
  disabled: '#9A968C',

  hairline: 'rgba(23,25,26,0.10)',
  divider: 'rgba(23,25,26,0.07)',

  chip: '#F0EEE8',
  chipAlt: '#ECEAE3',
  track: '#E4E1D9',
  toggleOff: '#D9D6CE',

  accent: '#2B4A8B',
  accentTint: '#E3E8F3',
  onTint: '#26314A',

  red: '#B8442E',
  errorSurface: '#FAEDE9',
  errorInk: '#5A2F25',
  amber: '#B8722E',

  panel: '#17191A',
  panelBody: '#B9B6AE'
} as const;

/** Pipeline stage dots, and the same colors reused for stage labels. */
export const stageColor = {
  Applied: color.disabled,
  Interview: color.amber,
  Offer: color.accent
} as const;

export const font = {
  ui: 'Archivo_400Regular',
  uiMedium: 'Archivo_500Medium',
  uiSemi: 'Archivo_600SemiBold',
  uiBold: 'Archivo_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold'
} as const;

export const type = {
  screenTitle: {
    fontFamily: font.uiBold,
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: -0.56,
    color: color.ink
  },
  eyebrow: {
    fontFamily: font.mono,
    fontSize: 9.5,
    letterSpacing: 1.9,
    color: color.faint
  },
  cardTitle: {
    fontFamily: font.uiSemi,
    fontSize: 16,
    lineHeight: 20,
    color: color.ink
  },
  cardSubtitle: {
    fontFamily: font.ui,
    fontSize: 13,
    lineHeight: 17,
    color: color.muted
  },
  body: {
    fontFamily: font.ui,
    fontSize: 13.5,
    lineHeight: 21,
    color: color.secondary
  },
  metaTag: {
    fontFamily: font.mono,
    fontSize: 9.5,
    letterSpacing: 0.76,
    color: color.muted
  },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    color: color.faint
  },
  bigStat: {
    fontFamily: font.monoBold,
    fontSize: 19,
    color: color.ink
  },
  tabLabel: {
    fontFamily: font.uiMedium,
    fontSize: 10
  }
} as const;

export const radius = {
  card: 14,
  inner: 12,
  button: 10,
  pill: 20,
  tag: 6
} as const;

export const space = {
  /** Screen side padding. Chip rows deliberately bleed past it. */
  screen: 18,
  card: 15,
  /** Gap between stacked cards. */
  gap: 11,
  /** Clears the status bar. */
  headerTop: 60,
  /** Clears the tab bar at the bottom of every scroll view. */
  scrollBottom: 108
} as const;

/**
 * Card elevation. RN needs shadow and elevation set separately, and iOS takes
 * the offset/radius pair where the CSS had one shorthand.
 */
export const shadow = {
  card: {
    shadowColor: '#17191A',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1
  },
  strong: {
    shadowColor: '#2B4A8B',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 3
  }
} as const;

/** A posting at or above this match score gets the navy strong-match treatment. */
export const STRONG = 92;
