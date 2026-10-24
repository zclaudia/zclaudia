import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeText, safeAttrValue, safeColor, safeSourceCssValue, safeStyleValue } from '../../html/values';
import { STYLE_SOURCE_VALUE_MAX } from '../../types';

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

describe('safeStyleValue', () => {
  it('routes color properties through safeColor', () => {
    expect(safeStyleValue('color', ' #abc ')).toBe('#abc');
    expect(safeStyleValue('background-color', 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(safeStyleValue('border-color', 'rebeccapurple')).toBe('rebeccapurple');
    expect(safeStyleValue('color', 'not-a-color')).toBeNull();
    expect(safeStyleValue('background-color', 'url(#fff)')).toBeNull();
  });

  it.each([
    ['font-size', '16px'],
    ['font-size', '1.25rem'],
    ['font-size', '0'],
    ['font-size', '1000px'],
    ['font-size', '120%'],
    ['width', 'auto'],
    ['width', '9999.999px'],
    ['width', '50vw'],
    ['height', '12.5vh'],
    ['margin', '-8px'],
    ['margin', 'auto'],
    ['margin-top', 'auto'],
    ['margin-left', '-1.5em'],
    ['padding', '0'],
    ['padding-top', '2em'],
    ['border-width', '2px'],
    ['border-radius', '50%'],
  ])('accepts %s %s', (property, value) => {
    expect(safeStyleValue(property, value)).toBe(value);
  });

  it.each([
    ['font-size', '-4px'], // negative not allowed for font-size
    ['font-size', '1001px'], // font-size cap is 1000
    ['font-size', '4px 8px'], // no shorthand for font-size
    ['width', '-1px'], // negative not allowed for width
    ['width', '10em 20em'], // no shorthand for width
    ['padding', '-1px'],
    ['padding', '4px auto'], // auto only for margin tokens
    ['padding-top', '-2px'],
    ['border-width', '-1px'],
    ['border-radius', '-4px'],
    ['margin-right', '1px 2px'], // single-value margin sides take one token
    ['font-size', '12345px'], // 5 integer digits
    ['font-size', '1.2345px'], // 4 fraction digits
    ['width', '10000px'], // 5 integer digits exceed the ≤4 rule
    ['width', '.5px'],
    ['width', '5.px'],
    ['width', '10'], // missing unit
    ['font-size', '10PX auto'],
  ])('rejects %s %s', (property, value) => {
    expect(safeStyleValue(property, value)).toBeNull();
  });

  it('accepts 1–4 token shorthand for margin/padding/border-width/border-radius', () => {
    expect(safeStyleValue('margin', '8px 12px')).toBe('8px 12px');
    expect(safeStyleValue('margin', '1px 2px 3px 4px')).toBe('1px 2px 3px 4px');
    expect(safeStyleValue('margin', 'auto auto')).toBe('auto auto');
    expect(safeStyleValue('margin', '-4px auto 0')).toBe('-4px auto 0');
    expect(safeStyleValue('padding', '1px 2px 3px')).toBe('1px 2px 3px');
    expect(safeStyleValue('border-width', '1px 2px')).toBe('1px 2px');
    expect(safeStyleValue('border-radius', '4px 8px 2px 1em')).toBe('4px 8px 2px 1em');
    expect(safeStyleValue('margin', '8px 12px 4px 2px 1px')).toBeNull(); // 5 tokens
    expect(safeStyleValue('margin', '8px bogus')).toBeNull();
    expect(safeStyleValue('border-radius', '4px 8px / 2px 4px')).toBeNull(); // slash syntax not allowed
  });

  it('accepts case-insensitive units and keeps the original spelling', () => {
    expect(safeStyleValue('width', '10PX')).toBe('10PX');
    expect(safeStyleValue('height', '5Rem')).toBe('5Rem');
  });

  it.each([
    ['normal'],
    ['1.5'],
    ['0.1'],
    ['10'],
    ['24px'],
    ['2'],
    ['0.5em'],
  ])('accepts line-height %s', value => {
    expect(safeStyleValue('line-height', value)).toBe(value);
  });

  it.each([
    ['0'],
    ['0.09'],
    ['10.1'],
    ['11'],
    ['-1'],
    ['0px'], // a *positive* length is required
    ['-2px'],
    ['1px 2px'],
    ['bogus'],
  ])('rejects line-height %s', value => {
    expect(safeStyleValue('line-height', value)).toBeNull();
  });

  it.each([
    ['normal'],
    ['bold'],
    ['bolder'],
    ['lighter'],
    ['BOLD'],
    ['100'],
    ['900'],
    ['350'], // hundred-step is not enforced
  ])('accepts font-weight %s', value => {
    expect(safeStyleValue('font-weight', value)).toBe(value);
  });

  it.each([
    ['50'],
    ['950'],
    ['901'],
    ['700.5'],
    ['-100'],
    ['heavy'],
  ])('rejects font-weight %s', value => {
    expect(safeStyleValue('font-weight', value)).toBeNull();
  });

  it('validates text-align keywords', () => {
    for (const keyword of ['left', 'right', 'center', 'justify', 'start', 'end']) {
      expect(safeStyleValue('text-align', keyword)).toBe(keyword);
    }
    expect(safeStyleValue('text-align', 'CENTER')).toBe('CENTER');
    expect(safeStyleValue('text-align', 'middle')).toBeNull();
    expect(safeStyleValue('text-align', 'left right')).toBeNull();
  });

  it('validates border-style keywords', () => {
    for (const keyword of ['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']) {
      expect(safeStyleValue('border-style', keyword)).toBe(keyword);
    }
    expect(safeStyleValue('border-style', 'SOLID')).toBe('SOLID');
    expect(safeStyleValue('border-style', 'wave')).toBeNull();
  });

  it('validates object-fit keywords', () => {
    for (const keyword of ['fill', 'contain', 'cover', 'none', 'scale-down']) {
      expect(safeStyleValue('object-fit', keyword)).toBe(keyword);
    }
    expect(safeStyleValue('object-fit', 'filler')).toBeNull();
  });

  it('accepts a permissive font-family stack and rejects injection vectors', () => {
    expect(safeStyleValue('font-family', '"Helvetica Neue", Arial, sans-serif')).toBe(
      '"Helvetica Neue", Arial, sans-serif'
    );
    expect(safeStyleValue('font-family', "'幼圆', '等线', monospace")).toBe("'幼圆', '等线', monospace");
    expect(safeStyleValue('font-family', 'Arial; Evil')).toBeNull();
    expect(safeStyleValue('font-family', 'a{b}')).toBeNull();
    expect(safeStyleValue('font-family', 'a}b')).toBeNull();
    expect(safeStyleValue('font-family', 'a<b')).toBeNull();
    expect(safeStyleValue('font-family', 'a>b')).toBeNull();
    expect(safeStyleValue('font-family', 'back\\slash')).toBeNull();
    expect(safeStyleValue('font-family', 'url(http://x) Arial')).toBeNull();
    expect(safeStyleValue('font-family', 'URL (http://x)')).toBeNull();
    expect(safeStyleValue('font-family', 'var(--x)')).toBeNull();
    expect(safeStyleValue('font-family', 'expression(alert(1))')).toBeNull();
    expect(safeStyleValue('font-family', 'EXPRESSION(x)')).toBeNull();
  });

  it('applies the common trim / empty / 120-char limits to every property', () => {
    expect(safeStyleValue('font-size', '  16px\t')).toBe('16px');
    expect(safeStyleValue('text-align', '')).toBeNull();
    expect(safeStyleValue('border-style', '   ')).toBeNull();
    expect(safeStyleValue('font-family', 'a'.repeat(120))).toBe('a'.repeat(120));
    expect(safeStyleValue('font-family', 'a'.repeat(121))).toBeNull();
  });
});

describe('safeSourceCssValue', () => {
  it.each([
    'red',
    '#ff0000',
    'rgb(1, 2, 3)',
    '1px solid #ccc',
    '10px 20px 30px 40px',
    'bold italic 12px/1.5 serif',
    'calc(100% - 2em)',
    '"Helvetica Neue", Arial, sans-serif',
    'inherit',
    'auto',
    'scale-down',
  ])('accepts %s and returns the original string', value => {
    expect(safeSourceCssValue(value)).toBe(value);
  });

  it.each([
    'red;', // would terminate the declaration early
    'a{b',
    'a}b',
    '/* note */ red', // comment open
    'red /*', // unterminated comment open
    'url(x)', // exfiltration / data vector
    'URL(x)',
    'background:url(a.png)',
    'expression(alert(1))',
    'EXPRESSION(X)',
    '@media', // at-rule injection
    'a@b',
    'a\nb', // C0 control characters
    'a\tb',
    'a\u0000b',
    'a\u0007b',
    'a\u001fb',
  ])('rejects %s', value => {
    expect(safeSourceCssValue(value)).toBeNull();
  });

  it('rejects values over STYLE_SOURCE_VALUE_MAX and accepts the boundary', () => {
    expect(safeSourceCssValue('a'.repeat(STYLE_SOURCE_VALUE_MAX))).toBe('a'.repeat(STYLE_SOURCE_VALUE_MAX));
    expect(safeSourceCssValue('a'.repeat(STYLE_SOURCE_VALUE_MAX + 1))).toBeNull();
  });

  it('passes values through verbatim (no trim, empty string stays legal)', () => {
    expect(safeSourceCssValue('  red  ')).toBe('  red  ');
    expect(safeSourceCssValue('')).toBe('');
  });
});

describe('safeAttrValue', () => {
  it('enforces tag matching: src/alt only on img, href only on a (case-insensitive)', () => {
    expect(safeAttrValue('src', 'a.png', 'img')).toBe('a.png');
    expect(safeAttrValue('src', 'a.png', 'IMG')).toBe('a.png');
    expect(safeAttrValue('src', 'a.png', 'div')).toBeNull();
    expect(safeAttrValue('alt', 'logo', 'img')).toBe('logo');
    expect(safeAttrValue('alt', 'logo', 'p')).toBeNull();
    expect(safeAttrValue('href', '#top', 'a')).toBe('#top');
    expect(safeAttrValue('href', '#top', 'A')).toBe('#top');
    expect(safeAttrValue('href', '#top', 'img')).toBeNull();
  });

  it('accepts relative image sources with whitelisted extensions', () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif']) {
      expect(safeAttrValue('src', `images/photo.${extension}`, 'img')).toBe(`images/photo.${extension}`);
    }
    expect(safeAttrValue('src', 'photo.PNG', 'img')).toBe('photo.PNG'); // extension match is case-insensitive
    expect(safeAttrValue('src', 'a.png?v=2#zoom', 'img')).toBe('a.png?v=2#zoom'); // fragment/query stripped for the check
  });

  it.each([
    '', // empty
    ' a.png', // leading whitespace
    'a.png\n', // trailing whitespace
    'https://example.com/a.png', // absolute scheme
    'HTTPS://X/A.PNG',
    '//cdn.example.com/a.png', // protocol-relative
    'data:image/png;base64,AAAA',
    'C:\\dir\\a.png', // backslash + drive-letter scheme
    'a\\b.png', // backslash
    'a.png\u0000',
    'a.txt', // extension not whitelisted
    'noext',
    'a.jpegx',
    `${'a'.repeat(497)}.png`, // 501 chars
  ])('rejects src %s', value => {
    expect(safeAttrValue('src', value, 'img')).toBeNull();
  });

  it('accepts the 500-char src boundary', () => {
    expect(safeAttrValue('src', `${'a'.repeat(496)}.png`, 'img')).toBe(`${'a'.repeat(496)}.png`);
  });

  it('accepts arbitrary non-control alt text within 500 chars', () => {
    expect(safeAttrValue('alt', '', 'img')).toBe('');
    expect(safeAttrValue('alt', '"quoted" & <i> — ✓', 'img')).toBe('"quoted" & <i> — ✓');
    expect(safeAttrValue('alt', 'a'.repeat(500), 'img')).toBe('a'.repeat(500));
    expect(safeAttrValue('alt', 'a'.repeat(501), 'img')).toBeNull();
    expect(safeAttrValue('alt', 'line\nbreak', 'img')).toBeNull(); // control character
    expect(safeAttrValue('alt', 'bell\u0007', 'img')).toBeNull();
  });

  it('allows relative paths, anchors and http(s)/mailto/tel schemes for href', () => {
    expect(safeAttrValue('href', '#anchor', 'a')).toBe('#anchor');
    expect(safeAttrValue('href', 'docs/page.html', 'a')).toBe('docs/page.html');
    expect(safeAttrValue('href', '../up/rel.png', 'a')).toBe('../up/rel.png');
    expect(safeAttrValue('href', 'https://example.com/a?b=1#c', 'a')).toBe('https://example.com/a?b=1#c');
    expect(safeAttrValue('href', 'HTTP://EXAMPLE.COM', 'a')).toBe('HTTP://EXAMPLE.COM');
    expect(safeAttrValue('href', 'mailto:hi@example.com', 'a')).toBe('mailto:hi@example.com');
    expect(safeAttrValue('href', 'tel:+8613800000000', 'a')).toBe('tel:+8613800000000');
    expect(safeAttrValue('href', 'a'.repeat(2000), 'a')).toBe('a'.repeat(2000));
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:x',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'a\u0001b', // control character
    'a'.repeat(2001),
  ])('rejects href %s', value => {
    expect(safeAttrValue('href', value, 'a')).toBeNull();
  });
});
