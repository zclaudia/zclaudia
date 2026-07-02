import { describe, expect, it } from 'vitest';
import { transformSvg } from '../../../../scripts/symbols/transform.mjs';

const MAP = { '#60A5FA': 'blue', '#F87171': 'red' };

describe('transformSvg', () => {
  it('rewrites mapped fill hex to a glyph-token style', () => {
    const out = transformSvg(
      'x',
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1" fill="#60A5FA"/></svg>',
      MAP
    );
    expect(out).toContain('style="fill:hsl(var(--glyph-blue))"');
    expect(out).not.toMatch(/fill="#/);
  });

  it('merges fill + stroke on one element into a single style attr', () => {
    const out = transformSvg(
      'x',
      '<svg viewBox="0 0 24 24" fill="none"><path d="M1 1" fill="#60A5FA" stroke="#F87171"/></svg>',
      MAP
    );
    expect(out).toContain('style="fill:hsl(var(--glyph-blue));stroke:hsl(var(--glyph-red))"');
  });

  it('strips width/height/xmlns from the root, keeps viewBox', () => {
    const out = transformSvg(
      'x',
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#60A5FA"/></svg>',
      MAP
    );
    expect(out).toMatch(/^<svg viewBox="0 0 24 24" fill="none">/);
  });

  it('leaves defs/mask/clipPath content untouched (mask white/black/#D9D9D9)', () => {
    const src =
      '<svg viewBox="0 0 24 24" fill="none"><mask id="m"><rect fill="white"/><rect fill="#D9D9D9"/></mask><path mask="url(#m)" fill="#60A5FA"/></svg>';
    const out = transformSvg('x', src, MAP);
    expect(out).toContain('<rect fill="white"/>');
    expect(out).toContain('<rect fill="#D9D9D9"/>');
    expect(out).toContain('style="fill:hsl(var(--glyph-blue))"');
  });

  it('throws on unmapped visible hex, naming icon and color', () => {
    expect(() =>
      transformSvg('badicon', '<svg viewBox="0 0 24 24"><path fill="#123456"/></svg>', MAP)
    ).toThrow(/badicon.*#123456/);
  });

  it('throws on gradient paint', () => {
    expect(() =>
      transformSvg('grad', '<svg viewBox="0 0 24 24"><path fill="url(#g)"/></svg>', MAP)
    ).toThrow(/gradient/);
  });

  it('throws on visible white/black paint', () => {
    expect(() =>
      transformSvg('wb', '<svg viewBox="0 0 24 24"><path fill="white"/></svg>', MAP)
    ).toThrow(/white/);
  });

  it('collapses newlines so output is a single line', () => {
    const out = transformSvg(
      'x',
      '<svg viewBox="0 0 24 24" fill="none">\n<path fill="#60A5FA"/>\n</svg>',
      MAP
    );
    expect(out).not.toContain('\n');
  });

  it('maps lowercase hex via uppercase lookup', () => {
    const out = transformSvg(
      'x',
      '<svg viewBox="0 0 24 24" fill="none"><path fill="#f87171"/></svg>',
      MAP
    );
    expect(out).toContain('style="fill:hsl(var(--glyph-red))"');
  });

  it('tolerates non-mapped stroke inside a mask block (java-like icon)', () => {
    const src =
      '<svg viewBox="0 0 24 24" fill="none"><mask id="m"><rect fill="#D9D9D9" stroke="#F87171"/></mask><path mask="url(#m)" fill="#60A5FA"/></svg>';
    const out = transformSvg('x', src, MAP);
    expect(out).toContain('<mask id="m"><rect fill="#D9D9D9" stroke="#F87171"/></mask>');
    expect(out).toContain('style="fill:hsl(var(--glyph-blue))"');
  });

  it('throws on single-quoted paint on a visible element', () => {
    expect(() =>
      transformSvg('sq', '<svg viewBox="0 0 24 24"><path fill=\'#123456\'/></svg>', MAP)
    ).toThrow(/sq.*#123456/);
  });

  it('throws when a mapped element already has a style attribute', () => {
    expect(() =>
      transformSvg(
        'st',
        '<svg viewBox="0 0 24 24"><path style="mask-type:alpha" fill="#60A5FA"/></svg>',
        MAP
      )
    ).toThrow(/style attribute/);
  });
});
