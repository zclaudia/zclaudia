// Measures how much of its viewBox a glyph's real ink occupies. Used by
// transform.mjs to re-frame outlier icons and by the generator regression
// test to guard against new upstream icons that would render too small or
// spill past the canvas. Curves are flattened by sampling so the bbox
// reflects actual ink, not just path anchor points.

function sampleCubic(acc, x0, y0, x1, y1, x2, y2, x3, y3) {
  for (let t = 0; t <= 1; t += 1 / 24) {
    const u = 1 - t;
    acc(
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
    );
  }
}

// Quadratic beziers are promoted to cubics so one sampler covers both.
function sampleQuad(acc, cx, cy, x1, y1, x, y) {
  sampleCubic(
    acc,
    cx,
    cy,
    cx + (2 / 3) * (x1 - cx),
    cy + (2 / 3) * (y1 - cy),
    x + (2 / 3) * (x1 - x),
    y + (2 / 3) * (y1 - y),
    x,
    y
  );
}

function pathBBox(d, acc) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0;
  const num = () => parseFloat(toks[i++]);
  let cx = 0,
    cy = 0,
    sx = 0,
    sy = 0,
    px = 0,
    py = 0,
    cmd = '';
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0,
      oy = rel ? cy : 0;
    if (C === 'M') {
      cx = ox + num();
      cy = oy + num();
      sx = cx;
      sy = cy;
      acc(cx, cy);
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      cx = ox + num();
      cy = oy + num();
      acc(cx, cy);
    } else if (C === 'H') {
      cx = ox + num();
      acc(cx, cy);
    } else if (C === 'V') {
      cy = oy + num();
      acc(cx, cy);
    } else if (C === 'C') {
      const x1 = ox + num(),
        y1 = oy + num(),
        x2 = ox + num(),
        y2 = oy + num(),
        x = ox + num(),
        y = oy + num();
      sampleCubic(acc, cx, cy, x1, y1, x2, y2, x, y);
      px = x2;
      py = y2;
      cx = x;
      cy = y;
    } else if (C === 'S') {
      const x1 = 2 * cx - px,
        y1 = 2 * cy - py,
        x2 = ox + num(),
        y2 = oy + num(),
        x = ox + num(),
        y = oy + num();
      sampleCubic(acc, cx, cy, x1, y1, x2, y2, x, y);
      px = x2;
      py = y2;
      cx = x;
      cy = y;
    } else if (C === 'Q') {
      const x1 = ox + num(),
        y1 = oy + num(),
        x = ox + num(),
        y = oy + num();
      sampleQuad(acc, cx, cy, x1, y1, x, y);
      px = x1;
      py = y1;
      cx = x;
      cy = y;
    } else if (C === 'T') {
      const x1 = 2 * cx - px,
        y1 = 2 * cy - py,
        x = ox + num(),
        y = oy + num();
      sampleQuad(acc, cx, cy, x1, y1, x, y);
      px = x1;
      py = y1;
      cx = x;
      cy = y;
    } else if (C === 'A') {
      num();
      num();
      num();
      num();
      num();
      const x = ox + num(),
        y = oy + num();
      acc(cx, cy);
      acc(x, y);
      cx = x;
      cy = y;
    } else if (C === 'Z') {
      cx = sx;
      cy = sy;
    } else i++;
  }
}

// Real-ink bounding box of the visible geometry. mask/clip/defs blocks are
// dropped first — their full-canvas rects are luminance infrastructure, not ink.
export function contentBBox(svg) {
  const visible = svg.replace(/<(defs|mask|clipPath)[\s\S]*?<\/\1>/g, '');
  const B = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const acc = (x, y) => {
    if (x < B.x0) B.x0 = x;
    if (y < B.y0) B.y0 = y;
    if (x > B.x1) B.x1 = x;
    if (y > B.y1) B.y1 = y;
  };
  const at = (el, a) => {
    const m = el.match(new RegExp(`${a}="(-?[\\d.]+)"`));
    return m ? parseFloat(m[1]) : 0;
  };
  for (const m of visible.matchAll(/<path[^>]*\bd="([^"]+)"/g)) pathBBox(m[1], acc);
  for (const m of visible.matchAll(/<rect[^>]*>/g)) {
    const x = at(m[0], 'x'),
      y = at(m[0], 'y');
    acc(x, y);
    acc(x + at(m[0], 'width'), y + at(m[0], 'height'));
  }
  for (const m of visible.matchAll(/<circle[^>]*>/g)) {
    const cx = at(m[0], 'cx'),
      cy = at(m[0], 'cy'),
      r = at(m[0], 'r');
    acc(cx - r, cy - r);
    acc(cx + r, cy + r);
  }
  for (const m of visible.matchAll(/<ellipse[^>]*>/g)) {
    const cx = at(m[0], 'cx'),
      cy = at(m[0], 'cy');
    acc(cx - at(m[0], 'rx'), cy - at(m[0], 'ry'));
    acc(cx + at(m[0], 'rx'), cy + at(m[0], 'ry'));
  }
  for (const m of visible.matchAll(/<(?:polygon|polyline)[^>]*\bpoints="([^"]+)"/g)) {
    const n = m[1].match(/-?[\d.]+/g).map(Number);
    for (let k = 0; k + 1 < n.length; k += 2) acc(n[k], n[k + 1]);
  }
  return isFinite(B.x0) ? B : null;
}

// Fill ratios as FileSymbol renders them: the whole viewBox scales into a
// square box under xMidYMid meet, so the longer viewBox side sets the scale.
// maxFill (dominant axis) is what the eye reads as the glyph's size; minFill
// exposes squat badges (markdown ~0.32) even when their width looks fine.
export function measureGlyph(svg) {
  const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 24 24').trim().split(/\s+/).map(Number);
  const [, , vw, vh] = vb;
  const b = contentBBox(svg);
  if (!b) return null;
  const w = b.x1 - b.x0,
    h = b.y1 - b.y0;
  const span = Math.max(vw, vh);
  return {
    bbox: b,
    w,
    h,
    viewBox: vb,
    maxFill: Math.max(w, h) / span,
    minFill: Math.min(w, h) / span,
  };
}
