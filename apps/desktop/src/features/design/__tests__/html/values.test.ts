import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeText, safeColor } from '../../html/values';

describe('safeColor', () => {
  it.each([
    ['#fff'],
    ['#ffff'],
    ['#ffffff'],
    ['#ffffffff'],
    ['#FfEeDd'],
    ['red'],
    ['rebeccapurple'],
    ['transparent'],
    [' rgb(1, 2, 3) '],
    ['rgba(1,2,3,0.5)'],
    ['hsl(120, 50%, 50%)'],
    ['hsla(120,50%,50%,0.2)'],
  ])('accepts %s', value => {
    expect(safeColor(value)).toBe(value.trim());
  });

  it.each([
    [''],
    ['   '],
    ['not-a-color'],
    [' javascript:alert(1)'],
    ['red; background: url(x)'],
    ['red{a}'],
    ['red<a'],
    ['red>b'],
    ['url(#fff)'],
    ['var(--x)'],
    ['expression(alert(1))'],
    ['rgb(1,2,3'],
    ['#12345'],
    ['#12345zz'],
    [`${'#'.repeat(39)}${'a'.repeat(43)}`], // > 80 chars
  ])('rejects %s', value => {
    expect(safeColor(value)).toBeNull();
  });

  it('trims the accepted value', () => {
    expect(safeColor('  #abc  ')).toBe('#abc');
  });
});

describe('escapeText', () => {
  it('escapes &, < and > for element text', () => {
    expect(escapeText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('leaves quotes untouched', () => {
    expect(escapeText('say "hi" \'bye\'')).toBe('say "hi" \'bye\'');
  });
  it('keeps other text intact', () => {
    expect(escapeText('Café — ¥ 伝')).toBe('Café — ¥ 伝');
  });
});

describe('escapeAttr', () => {
  it('escapes & and " for double-quoted attributes', () => {
    expect(escapeAttr('a & b " c')).toBe('a &amp; b &quot; c');
  });
  it('leaves < and > untouched', () => {
    expect(escapeAttr('<script>')).toBe('<script>');
  });
});
