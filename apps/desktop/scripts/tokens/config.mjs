// Theme token definitions. Every neutral must sit on the theme's hue axis;
// the surface ladder is sidebar < background < card (= popover) in all modes.
// Regenerate CSS with: pnpm --filter @zclaudia/desktop run gen:tokens
// Design rationale: docs/superpowers/specs/2026-07-02-warm-palette-retune-design.md

// Symbols file-glyph palette — decorative file-type colors for
// src/components/filesymbols/ only; deliberately separate from the status
// accents so "JS yellow" never reads as warning. Starting values; tune
// during the five-theme smoke pass.
const lightGlyphs = {
  'glyph-red': [4, 60, 48],
  'glyph-orange': [24, 70, 46],
  'glyph-amber': [42, 72, 44],
  'glyph-green': [150, 45, 38],
  'glyph-teal': [180, 45, 38],
  'glyph-blue': [214, 65, 48],
  'glyph-purple': [265, 45, 52],
  'glyph-pink': [330, 55, 52],
  'glyph-gray': [45, 5, 50],
};

const darkGlyphs = {
  'glyph-red': [4, 60, 64],
  'glyph-orange': [24, 65, 62],
  'glyph-amber': [44, 65, 60],
  'glyph-green': [150, 40, 58],
  'glyph-teal': [180, 40, 58],
  'glyph-blue': [214, 60, 64],
  'glyph-purple': [265, 45, 66],
  'glyph-pink': [330, 50, 66],
  'glyph-gray': [45, 6, 62],
};

// Terminal ANSI 16-color palette — hue-anchored to the accent/glyph system
// (red 4 = destructive, green 150 = success, yellow 38-44 = warning,
// blue 214 = primary, magenta 285 ≈ glyph-purple, cyan 185-190 ≈ glyph-teal).
// white/bright-white stay deliberately light: their semantic role is background
// blocks and reverse video; foreground use is rescued by xterm's
// minimumContrastRatio (see TerminalController).
const lightAnsi = {
  'terminal-ansi-black': [45, 8, 16],
  'terminal-ansi-red': [4, 66, 45],
  'terminal-ansi-green': [150, 48, 33],
  'terminal-ansi-yellow': [38, 80, 38],
  'terminal-ansi-blue': [214, 70, 45],
  'terminal-ansi-magenta': [285, 45, 48],
  'terminal-ansi-cyan': [190, 65, 32],
  'terminal-ansi-white': [45, 6, 78],
  'terminal-ansi-bright-black': [45, 5, 43],
  'terminal-ansi-bright-red': [4, 70, 52],
  'terminal-ansi-bright-green': [150, 45, 40],
  'terminal-ansi-bright-yellow': [40, 78, 45],
  'terminal-ansi-bright-blue': [214, 70, 56],
  'terminal-ansi-bright-magenta': [285, 50, 58],
  'terminal-ansi-bright-cyan': [190, 60, 40],
  'terminal-ansi-bright-white': [45, 10, 88],
};

const darkAnsi = {
  'terminal-ansi-black': [35, 6, 22],
  'terminal-ansi-red': [4, 60, 62],
  'terminal-ansi-green': [150, 40, 56],
  'terminal-ansi-yellow': [42, 65, 60],
  'terminal-ansi-blue': [214, 62, 64],
  'terminal-ansi-magenta': [285, 45, 68],
  'terminal-ansi-cyan': [185, 45, 56],
  'terminal-ansi-white': [35, 10, 80],
  'terminal-ansi-bright-black': [35, 6, 45],
  'terminal-ansi-bright-red': [4, 65, 68],
  'terminal-ansi-bright-green': [150, 42, 63],
  'terminal-ansi-bright-yellow': [44, 70, 66],
  'terminal-ansi-bright-blue': [214, 65, 70],
  'terminal-ansi-bright-magenta': [285, 50, 74],
  'terminal-ansi-bright-cyan': [185, 50, 63],
  'terminal-ansi-bright-white': [35, 12, 93],
};

const lightAccents = {
  primary: [214, 70, 45],
  'primary-foreground': [0, 0, 100],
  ring: [214, 70, 45],
  destructive: [4, 66, 45],
  'destructive-foreground': [0, 0, 100],
  success: [150, 48, 33],
  'success-foreground': [150, 40, 97],
  warning: [38, 80, 44],
  'warning-foreground': [35, 80, 12],
  thinking: [265, 45, 50],
  'thinking-foreground': [265, 60, 97],
  'terminal-cursor': [214, 70, 45],
  'terminal-selection': [214, 70, 88],
  ...lightGlyphs,
  ...lightAnsi,
};

const darkAccents = {
  primary: [214, 70, 60],
  'primary-foreground': [220, 20, 10],
  ring: [214, 70, 60],
  destructive: [4, 62, 48],
  'destructive-foreground': [0, 0, 98],
  success: [150, 40, 52],
  'success-foreground': [150, 45, 10],
  warning: [40, 70, 55],
  'warning-foreground': [35, 65, 12],
  thinking: [265, 42, 65],
  'thinking-foreground': [265, 60, 10],
  'terminal-cursor': [214, 70, 60],
  ...darkGlyphs,
  ...darkAnsi,
};

function darkNeutrals(hue, sat, satText) {
  return {
    background: [hue, sat, 8.5],
    foreground: [hue, satText, 91],
    card: [hue, sat, 11.5],
    sidebar: [hue, sat, 6.5],
    'card-foreground': [hue, satText, 91],
    popover: [hue, sat, 11.5],
    'popover-foreground': [hue, satText, 91],
    secondary: [hue, Math.max(sat - 1, 4), 14],
    'secondary-foreground': [hue, satText - 2, 86],
    muted: [hue, Math.max(sat - 1, 4), 14],
    // saturation floors at 6 — a future theme with satText < 10 clamps here
    'muted-foreground': [hue, Math.max(satText - 4, 6), 60],
    accent: [hue, sat, 17],
    'accent-foreground': [hue, satText - 2, 86],
    border: [hue, sat, 17.5],
    input: [hue, sat, 16],
    'scrollbar-thumb': [hue, sat, 27],
    'scrollbar-thumb-hover': [hue, sat, 35],
    'terminal-bg': [hue, sat, 6.5],
    'terminal-fg': [hue, satText, 91],
  };
}

export const themes = [
  {
    name: 'light',
    selector: ':root',
    hue: 45,
    neutrals: {
      background: [45, 25, 97],
      foreground: [45, 8, 10],
      card: [45, 30, 99],
      sidebar: [45, 15, 93],
      'card-foreground': [45, 8, 10],
      popover: [45, 30, 99],
      'popover-foreground': [45, 8, 10],
      secondary: [45, 12, 90],
      'secondary-foreground': [45, 8, 20],
      muted: [45, 12, 91],
      'muted-foreground': [45, 5, 40],
      accent: [45, 12, 87],
      'accent-foreground': [45, 8, 20],
      border: [45, 10, 86],
      input: [45, 10, 86],
      'scrollbar-thumb': [45, 8, 75],
      'scrollbar-thumb-hover': [45, 8, 62],
      'terminal-bg': [45, 15, 95],
      'terminal-fg': [45, 8, 10],
    },
    accents: lightAccents,
  },
  {
    name: 'light-cool',
    selector: '.light-cool',
    hue: 225,
    neutrals: {
      background: [225, 14, 97],
      foreground: [225, 12, 10],
      card: [225, 16, 99],
      sidebar: [225, 12, 93],
      'card-foreground': [225, 12, 10],
      popover: [225, 16, 99],
      'popover-foreground': [225, 12, 10],
      secondary: [225, 10, 90],
      'secondary-foreground': [225, 10, 20],
      muted: [225, 10, 91],
      'muted-foreground': [225, 6, 40],
      accent: [225, 10, 87],
      'accent-foreground': [225, 10, 20],
      border: [225, 9, 86],
      input: [225, 9, 86],
      'scrollbar-thumb': [225, 7, 75],
      'scrollbar-thumb-hover': [225, 7, 62],
      'terminal-bg': [225, 10, 95],
      'terminal-fg': [225, 12, 10],
    },
    accents: lightAccents,
  },
  {
    name: 'dark',
    selector: '.dark',
    hue: 35,
    neutrals: darkNeutrals(35, 6, 10),
    accents: { ...darkAccents, 'terminal-selection': [35, 6, 20] },
  },
  {
    name: 'dark-warm',
    selector: '.dark.dark-warm',
    hue: 30,
    neutrals: darkNeutrals(30, 7, 12),
    accents: { ...darkAccents, 'terminal-selection': [30, 7, 20] },
  },
  {
    name: 'dark-cool',
    selector: '.dark.dark-cool',
    hue: 225,
    neutrals: darkNeutrals(225, 13, 18),
    accents: { ...darkAccents, 'terminal-selection': [225, 13, 20] },
  },
];
