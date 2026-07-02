import assert from 'node:assert/strict';
import test from 'node:test';
import { themes } from '../tokens/config.mjs';
import { contrastRatio, validateTheme, renderTokens } from '../tokens/lib.mjs';

test('black on white has ~21:1 contrast', () => {
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [0, 0, 100]) - 21) < 0.1);
});

test('there are exactly four themes with the expected axes', () => {
  assert.deepEqual(
    themes.map(t => [t.name, t.hue]),
    [
      ['light', 45],
      ['dark', 35],
      ['dark-warm', 30],
      ['dark-cool', 225],
    ]
  );
});

test('all four themes pass validation', () => {
  for (const theme of themes) {
    assert.deepEqual(validateTheme(theme), [], `${theme.name} should validate clean`);
  }
});

test('an off-axis neutral is rejected', () => {
  const theme = structuredClone(themes[0]);
  theme.neutrals.border = [220, 10, 86];
  assert.ok(validateTheme(theme).some(e => e.includes('--border')));
});

test('a surface-ladder violation is rejected', () => {
  const theme = structuredClone(themes[0]);
  theme.neutrals.card = [theme.hue, 30, 90];
  assert.ok(validateTheme(theme).some(e => e.includes('ladder')));
});

test('a contrast violation is rejected', () => {
  const theme = structuredClone(themes[0]);
  theme.neutrals['muted-foreground'] = [theme.hue, 5, 80];
  assert.ok(validateTheme(theme).some(e => e.includes('contrast')));
});

test('renderTokens emits css custom properties in config order', () => {
  const css = renderTokens(themes[0]);
  assert.match(css, /--background: 45 25% 97%;/);
  assert.match(css, /--primary: 214 70% 45%;/);
  assert.ok(css.startsWith('    --background:'));
});

test('a missing token produces a validation error, not a crash', () => {
  const theme = structuredClone(themes[0]);
  delete theme.neutrals.sidebar;
  const errors = validateTheme(theme);
  assert.ok(errors.some(e => e.includes('missing token --sidebar')));
});

test('popover diverging from card is rejected on its own', () => {
  const theme = structuredClone(themes[0]);
  theme.neutrals.popover = [theme.hue, 5, theme.neutrals.popover[2]];
  const errors = validateTheme(theme);
  assert.ok(errors.some(e => e.includes('--popover must equal --card')));
  assert.ok(!errors.some(e => e.includes('ladder')));
});
