// Rewrites vscode-symbols SVG paint colors into theme glyph tokens.
// SVG presentation attributes don't support var(), so mapped colors move
// into an inline style attribute. defs/mask/clipPath blocks pass through
// untouched — paints there (white/black/#D9D9D9, even stray strokes) are
// mask-luminance infrastructure, so the leftover scan skips those blocks.
import { contentBBox } from './glyph-metrics.mjs';

const PASSTHROUGH = new Set(['none', 'currentColor']);

const DEFS_BLOCK = /(<(?:defs|mask|clipPath)[\s\S]*?<\/(?:defs|mask|clipPath)>)/g;

function transformVisible(name, segment, colorMap) {
  if (/(?:fill|stroke)="url\(/.test(segment)) {
    throw new Error(`${name}: gradient paint is not supported — drop or substitute this icon`);
  }
  if (/(?:fill|stroke)="(?:white|black)"/.test(segment)) {
    throw new Error(`${name}: visible white/black paint needs an explicit mapping decision`);
  }
  const out = segment.replace(
    /<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g,
    (tag, el, attrs, selfClose) => {
      const decls = [];
      const rest = attrs.replace(/\s(fill|stroke)="(#[0-9A-Fa-f]{6})"/g, (_m, prop, hex) => {
        const slot = colorMap[hex.toUpperCase()];
        if (!slot) throw new Error(`${name}: unmapped color ${hex}`);
        decls.push(`${prop}:hsl(var(--glyph-${slot}))`);
        return '';
      });
      if (decls.length === 0) return tag;
      if (/\sstyle="/.test(rest)) {
        throw new Error(`${name}: element already has a style attribute`);
      }
      return `<${el}${rest} style="${decls.join(';')}"${selfClose ? '/' : ''}>`;
    }
  );

  // Quote-agnostic so single-quoted paint can't slip past the tag regex above.
  const leftover = [...out.matchAll(/(?:fill|stroke)=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(v => !PASSTHROUGH.has(v));
  if (leftover.length > 0) {
    throw new Error(`${name}: unhandled paint value(s): ${[...new Set(leftover)].join(', ')}`);
  }
  return out;
}

// --- viewBox normalization -----------------------------------------------
// Some upstream glyphs draw their artwork small (markdown/mdx: ~32% canvas
// height), oversized (xml overflows its viewBox), or as a squat badge, so
// they render visibly smaller/clipped than the pack once FileSymbol scales
// the whole viewBox into a fixed box. We measure real ink and, ONLY for
// out-of-band outliers, re-frame the viewBox (tight-crop or pad, centered,
// aspect preserved) so dominant-axis fill lands in a consistent range. Icons
// already framed normally are left byte-identical.
const FILL_LOW = 0.66; // below this on the dominant axis -> too small
const FILL_HIGH = 0.95; // above this -> overflowing / too big
const FLAT_MIN = 0.4; // minor-axis fill below this -> squat badge (e.g. markdown)
const TARGET_SMALL = 0.75; // enlarge undersized glyphs to match the median
const TARGET_BIG = 0.85; // shrink oversized glyphs to sit inside the box
const TARGET_FLAT = 0.9; // push squat badges as large as aspect allows

function fmt(n) {
  return Number(n.toFixed(3)).toString();
}

function normalizeViewBox(name, svg) {
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  if (!vbMatch) throw new Error(`${name}: missing viewBox`);
  const [, , vw, vh] = vbMatch[1].trim().split(/\s+/).map(Number);
  const b = contentBBox(svg);
  if (!b) return svg;
  const w = b.x1 - b.x0,
    h = b.y1 - b.y0;
  const maxDim = Math.max(w, h);
  if (maxDim === 0) return svg;
  const maxFill = maxDim / Math.max(vw, vh);
  const minFill = Math.min(w / vw, h / vh);
  let target = null;
  if (maxFill > FILL_HIGH) target = TARGET_BIG;
  else if (maxFill < FILL_LOW) target = TARGET_SMALL;
  else if (minFill < FLAT_MIN) target = TARGET_FLAT;
  if (target === null) return svg; // already well-framed -> leave untouched
  const side = maxDim / target;
  const nx = b.x0 + w / 2 - side / 2;
  const ny = b.y0 + h / 2 - side / 2;
  return svg.replace(
    /viewBox="[^"]+"/,
    `viewBox="${fmt(nx)} ${fmt(ny)} ${fmt(side)} ${fmt(side)}"`
  );
}

export function transformSvg(name, svg, colorMap) {
  const painted = svg
    .split(DEFS_BLOCK)
    .map((part, i) => (i % 2 === 1 ? part : transformVisible(name, part, colorMap)))
    .join('')
    .replace(/<svg[^>]*>/, root => root.replace(/\s(?:width|height|xmlns)="[^"]*"/g, ''));
  return (
    normalizeViewBox(name, painted)
      // upstream SVGs are one element per line; collapsing newlines cannot fuse attributes
      .replace(/\r?\n\s*/g, '')
  );
}
