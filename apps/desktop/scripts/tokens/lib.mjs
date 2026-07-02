// HSL math, WCAG contrast, config validation and CSS rendering for theme tokens.
// Values are [h, s, l] triples matching the CSS custom-property format "h s% l%".

export function hslToRgb([h, s, l]) {
  const sat = s / 100;
  const lig = l / 100;
  const k = n => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = n => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hslA, hslB) {
  const la = relativeLuminance(hslToRgb(hslA));
  const lb = relativeLuminance(hslToRgb(hslB));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const CONTRAST_GATES = [
  ['foreground', 'background', 7],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['success-foreground', 'success', 4.5],
  ['warning-foreground', 'warning', 4.5],
  ['thinking-foreground', 'thinking', 4.5],
];

export function validateTheme(theme) {
  const errors = [];
  const all = { ...theme.neutrals, ...theme.accents };

  for (const [token, [h]] of Object.entries(theme.neutrals)) {
    if (h !== theme.hue) {
      errors.push(`${theme.name}: neutral --${token} hue ${h} is off the ${theme.hue}° axis`);
    }
  }

  const l = token => all[token][2];
  if (!(l('sidebar') < l('background') && l('background') < l('card'))) {
    errors.push(
      `${theme.name}: surface ladder violated — need sidebar(${l('sidebar')}) < background(${l('background')}) < card(${l('card')})`
    );
  }
  if (all.card.join() !== all.popover.join()) {
    errors.push(`${theme.name}: --popover must equal --card`);
  }

  for (const [fg, bg, floor] of CONTRAST_GATES) {
    const ratio = contrastRatio(all[fg], all[bg]);
    if (ratio < floor) {
      errors.push(
        `${theme.name}: contrast --${fg} on --${bg} is ${ratio.toFixed(2)}, needs ≥ ${floor}`
      );
    }
  }
  return errors;
}

export function renderTokens(theme) {
  const all = { ...theme.neutrals, ...theme.accents };
  return Object.entries(all)
    .map(([token, [h, s, l]]) => `    --${token}: ${h} ${s}% ${l}%;`)
    .join('\n');
}
