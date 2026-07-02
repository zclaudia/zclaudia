// Theme token definitions. Every neutral must sit on the theme's hue axis;
// the surface ladder is sidebar < background < card (= popover) in all modes.
// Regenerate CSS with: pnpm --filter @zclaudia/desktop run gen:tokens
// Design rationale: docs/superpowers/specs/2026-07-02-warm-palette-retune-design.md

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
      'muted-foreground': [45, 5, 43],
      accent: [45, 12, 87],
      'accent-foreground': [45, 8, 20],
      border: [45, 10, 86],
      input: [45, 10, 86],
      'scrollbar-thumb': [45, 8, 75],
      'scrollbar-thumb-hover': [45, 8, 62],
      'terminal-bg': [45, 15, 95],
      'terminal-fg': [45, 8, 10],
    },
    accents: {
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
    },
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
