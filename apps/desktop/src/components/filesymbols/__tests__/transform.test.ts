import { describe, expect, it } from 'vitest';
import { transformSvg } from '../../../../scripts/symbols/transform.mjs';
import { measureGlyph } from '../../../../scripts/symbols/glyph-metrics.mjs';
import { SYMBOLS } from '../generated/symbols';

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

  describe('viewBox normalization', () => {
    // A squat glyph (ink only ~10% of a 24-tall canvas, but full width) is
    // re-framed to a tight square so it stops rendering tiny.
    it('re-frames a squat glyph so its dominant axis fills the box', () => {
      const src =
        '<svg viewBox="0 0 24 24" fill="none"><path d="M3 11H21V13H3Z" fill="#60A5FA"/></svg>';
      const before = measureGlyph(src);
      const after = measureGlyph(transformSvg('squat', src, MAP));
      expect(before.maxFill).toBeLessThan(0.8);
      expect(after.maxFill).toBeGreaterThan(0.88);
    });

    // Ink spilling past the viewBox would clip in FileSymbol; it must shrink in.
    it('pulls an overflowing glyph back inside the viewBox', () => {
      const src =
        '<svg viewBox="0 0 24 24" fill="none"><path d="M-3 -3H27V27H-3Z" fill="#60A5FA"/></svg>';
      expect(measureGlyph(src).maxFill).toBeGreaterThan(1);
      expect(measureGlyph(transformSvg('big', src, MAP)).maxFill).toBeLessThanOrEqual(0.9);
    });

    // A well-framed glyph is left byte-identical — only outliers are touched.
    it('leaves an in-band glyph untouched', () => {
      const src =
        '<svg viewBox="0 0 24 24" fill="none"><path d="M3 3H21V21H3Z" fill="#60A5FA"/></svg>';
      const out = transformSvg('ok', src, MAP);
      expect(out).toContain('viewBox="0 0 24 24"');
    });

    it('emits a square viewBox so FileSymbol cannot distort the aspect', () => {
      const src =
        '<svg viewBox="0 0 24 24" fill="none"><path d="M2 10H22V14H2Z" fill="#60A5FA"/></svg>';
      const [, , w, h] = measureGlyph(transformSvg('wide', src, MAP)).viewBox;
      expect(w).toBeCloseTo(h, 3);
    });
  });

  // Guards the shipped icon set: every generated glyph must render at a
  // consistent visual size. Catches new upstream icons that slip in too small
  // or overflowing, and any regression in the normalization pass itself.
  describe('generated symbol set fill ratios', () => {
    const entries = Object.entries(SYMBOLS);

    it('ships 72 icons', () => {
      expect(entries.length).toBe(72);
    });

    it.each(entries)('%s renders within the consistent fill band', (_name, svg) => {
      const { maxFill } = measureGlyph(svg);
      expect(maxFill).toBeGreaterThanOrEqual(0.62); // not visibly small
      expect(maxFill).toBeLessThanOrEqual(0.96); // not clipping the canvas
    });
  });
});
