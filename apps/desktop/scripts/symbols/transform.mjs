// Rewrites vscode-symbols SVG paint colors into theme glyph tokens.
// SVG presentation attributes don't support var(), so mapped colors move
// into an inline style attribute. defs/mask/clipPath blocks pass through
// untouched — paints there (white/black/#D9D9D9, even stray strokes) are
// mask-luminance infrastructure, so the leftover scan skips those blocks.
const PASSTHROUGH = new Set(['none', 'currentColor']);

const DEFS_BLOCK = /(<(?:defs|mask|clipPath)[\s\S]*?<\/(?:defs|mask|clipPath)>)/g;

function transformVisible(name, segment, colorMap) {
  if (/(?:fill|stroke)="url\(/.test(segment)) {
    throw new Error(`${name}: gradient paint is not supported — drop or substitute this icon`);
  }
  if (/(?:fill|stroke)="(?:white|black)"/.test(segment)) {
    throw new Error(`${name}: visible white/black paint needs an explicit mapping decision`);
  }
  const out = segment.replace(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (tag, el, attrs, selfClose) => {
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
  });

  // Quote-agnostic so single-quoted paint can't slip past the tag regex above.
  const leftover = [...out.matchAll(/(?:fill|stroke)=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(v => !PASSTHROUGH.has(v));
  if (leftover.length > 0) {
    throw new Error(`${name}: unhandled paint value(s): ${[...new Set(leftover)].join(', ')}`);
  }
  return out;
}

export function transformSvg(name, svg, colorMap) {
  return svg
    .split(DEFS_BLOCK)
    .map((part, i) => (i % 2 === 1 ? part : transformVisible(name, part, colorMap)))
    .join('')
    .replace(/<svg[^>]*>/, root => root.replace(/\s(?:width|height|xmlns)="[^"]*"/g, ''))
    // upstream SVGs are one element per line; collapsing newlines cannot fuse attributes
    .replace(/\r?\n\s*/g, '');
}
