/**
 * Generate every brand asset from the selected C2 SVG.
 * --check regenerates in memory and verifies committed outputs without writing.
 */
import sharp from 'sharp';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DESKTOP = path.join(ROOT, 'apps/desktop');
const ICONS = 'apps/desktop/src-tauri/icons';
const PUBLIC = 'apps/desktop/public';
const BACKGROUND = '#F4F6FA';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const IOS_SIZES = {
  'AppIcon-20x20@1x.png': 20,
  'AppIcon-20x20@2x.png': 40,
  'AppIcon-20x20@3x.png': 60,
  'AppIcon-29x29@1x.png': 29,
  'AppIcon-29x29@2x.png': 58,
  'AppIcon-29x29@3x.png': 87,
  'AppIcon-40x40@1x.png': 40,
  'AppIcon-40x40@2x.png': 80,
  'AppIcon-40x40@3x.png': 120,
  'AppIcon-60x60@2x.png': 120,
  'AppIcon-60x60@3x.png': 180,
  'AppIcon-76x76@1x.png': 76,
  'AppIcon-76x76@2x.png': 152,
  'AppIcon-83.5x83.5@2x.png': 167,
  'AppIcon-512@2x.png': 1024,
};
const WINDOWS_SIZES = [30, 44, 71, 89, 107, 142, 150, 284, 310];

// Tauri's ICNS encoder emits representations in hash-map order. Canonicalize
// the container so reruns and --check stay stable without re-encoding images.
function canonicalIcns(data) {
  if (data.toString('ascii', 0, 4) !== 'icns' || data.readUInt32BE(4) !== data.length) {
    throw new Error('Tauri produced an invalid ICNS header.');
  }
  const chunks = [];
  for (let offset = 8; offset < data.length; ) {
    if (offset + 8 > data.length) throw new Error('Truncated ICNS chunk.');
    const length = data.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > data.length) throw new Error('Invalid ICNS chunk.');
    chunks.push(data.subarray(offset, offset + length));
    offset += length;
  }
  chunks.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([data.subarray(0, 8), ...chunks]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: regenerate-icons.mjs [--check]');
  const check = args.includes('--check');
  const source = await fs.readFile(path.join(ROOT, 'assets/branding/mascot-c2.svg'), 'utf8');
  const inner = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  const head = inner?.match(/<path\s+id="head"[^>]*\/>/)?.[0];
  const faceMask = inner?.match(/<path\s+id="face-mask"[^>]*\/>/)?.[0];
  const eyes = inner?.match(/<rect\s+id="eye-(?:left|right)"[^>]*\/>/g);
  if (!head || !faceMask || eyes?.length !== 2)
    throw new Error('C2 master must contain head, face mask, and two eye shapes.');

  const attribute = (element, name) => {
    const value = element.match(new RegExp('\\b' + name + '="([^"]+)"'))?.[1];
    if (value === undefined) throw new Error('Missing C2 shape attribute: ' + name);
    return value;
  };
  const eyeShapes = eyes.map(eye => ({
    x: Number(attribute(eye, 'x')),
    y: Number(attribute(eye, 'y')),
    width: Number(attribute(eye, 'width')),
    height: Number(attribute(eye, 'height')),
    rx: Number(attribute(eye, 'rx')),
    fill: attribute(eye, 'fill'),
  }));
  // Rounded eye contours become actual holes in the monochrome path. Inline
  // SVG can draw these directly without offscreen SVG/CSS mask surfaces.
  const eyeContour = ({ x, y, width, height, rx }) => {
    const r = Math.min(rx, width / 2, height / 2);
    return `M ${x + r} ${y} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${y + r} V ${y + height - r} A ${r} ${r} 0 0 1 ${x + width - r} ${y + height} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + height - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
  };

  const svg = content =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
    content +
    '</svg>\n';
  const scaled = scale =>
    '<g transform="translate(256 256) scale(' + scale + ') translate(-256 -256)">' + inner + '</g>';
  const mono = (color, scale = 1) =>
    svg(
      '<defs><mask id="silhouette" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">' +
        head.replace(/fill="[^"]+"/, 'fill="#FFFFFF"') +
        eyes.map(eye => eye.replace(/fill="[^"]+"/, 'fill="#000000"')).join('') +
        '</mask></defs><g transform="translate(256 256) scale(' +
        scale +
        ') translate(-256 -256)">' +
        '<rect width="512" height="512" fill="' +
        color +
        '" mask="url(#silhouette)" /></g>'
    );
  const appSvg = svg(
    '<rect width="512" height="512" rx="104" fill="' + BACKGROUND + '" />' + scaled(0.88)
  );
  const mobileSvg = svg(
    '<rect width="512" height="512" fill="' + BACKGROUND + '" />' + scaled(0.88)
  );
  // Keep the adaptive foreground inside Android's central safe area.
  const adaptiveSvg = svg(scaled(0.72));
  const outputs = new Map();
  const put = (relative, content) =>
    outputs.set(relative, Buffer.isBuffer(content) ? content : Buffer.from(content));
  const png = async (relative, content, size, opaque = false) => {
    let pipeline = sharp(Buffer.from(content), { density: 288 }).resize(size, size);
    if (opaque) pipeline = pipeline.flatten({ background: BACKGROUND }).removeAlpha();
    put(relative, await pipeline.png().toBuffer());
  };

  put(PUBLIC + '/logo.svg', source);
  put(PUBLIC + '/logo-monochrome.svg', mono('#000000'));
  put(
    'apps/desktop/src/components/brand-shapes.generated.ts',
    '// Generated from assets/branding/mascot-c2.svg by pnpm icons:generate.\n' +
      '// prettier-ignore\nexport const BRAND_SHAPES = ' +
      JSON.stringify(
        {
          head: { d: attribute(head, 'd'), fill: attribute(head, 'fill') },
          faceMask: { d: attribute(faceMask, 'd'), fill: attribute(faceMask, 'fill') },
          eyes: eyeShapes,
          monochromePath: [attribute(head, 'd'), ...eyeShapes.map(eyeContour)].join(' '),
        },
        null,
        2
      ) +
      ' as const;\n'
  );
  put('assets/zclaudia.svg', source);
  put('apps/desktop/app-icon.svg', appSvg);
  put('assets/branding/mascot-c2-monochrome.svg', mono('#000000'));
  await png('assets/branding/mascot-c2-flat.png', source, 1024);
  for (const name of ['logo.png', 'logo-transparent.png', 'logo-transparent-dark.png']) {
    await png(PUBLIC + '/' + name, source, 512);
  }
  await png(PUBLIC + '/favicon-32x32.png', source, 32);
  await png(PUBLIC + '/favicon.png', source, 64);
  await png(PUBLIC + '/apple-touch-icon.png', mobileSvg, 180, true);
  await png('apps/desktop/app-icon.png', appSvg, 1024);
  for (const [name, size] of Object.entries({
    '32x32.png': 32,
    '64x64.png': 64,
    '128x128.png': 128,
    '128x128@2x.png': 256,
    'icon.png': 512,
  })) {
    await png(ICONS + '/' + name, appSvg, size);
  }
  for (const size of WINDOWS_SIZES)
    await png(ICONS + '/Square' + size + 'x' + size + 'Logo.png', appSvg, size);
  await png(ICONS + '/StoreLogo.png', appSvg, 50);
  for (const [name, size] of Object.entries(IOS_SIZES))
    await png(ICONS + '/ios/' + name, mobileSvg, size, true);
  for (const [suffix, size] of Object.entries({ '.png': 18, '@2x.png': 36, '-32.png': 32 })) {
    await png(ICONS + '/tray-icon' + suffix, mono('#000000'), size);
    await png(ICONS + '/tray-icon-light' + suffix, mono('#FFFFFF'), size);
  }
  for (const [density, factor] of Object.entries(DENSITIES)) {
    const dir = ICONS + '/android/mipmap-' + density;
    await png(dir + '/ic_launcher.png', mobileSvg, 48 * factor, true);
    await png(dir + '/ic_launcher_foreground.png', adaptiveSvg, 108 * factor);
    await png(dir + '/ic_launcher_monochrome.png', mono('#FFFFFF', 0.72), 108 * factor);
    await png(
      ICONS + '/android/drawable-' + density + '/ic_stat_claudia.png',
      mono('#FFFFFF'),
      24 * factor
    );
    // Pre-adaptive launchers need a genuinely circular fallback with transparent corners.
    const roundSvg = svg(
      '<defs><clipPath id="round"><circle cx="256" cy="256" r="256" /></clipPath></defs><g clip-path="url(#round)"><rect width="512" height="512" fill="' +
        BACKGROUND +
        '" />' +
        scaled(0.8) +
        '</g>'
    );
    await png(dir + '/ic_launcher_round.png', roundSvg, 48 * factor);
  }
  const adaptiveXml =
    '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background" />\n  <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n';
  const themedXml = adaptiveXml.replace(
    '</adaptive-icon>',
    '  <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>'
  );
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    put(ICONS + '/android/mipmap-anydpi-v26/' + name, adaptiveXml);
    put(ICONS + '/android/mipmap-anydpi-v33/' + name, themedXml);
  }
  put(
    ICONS + '/android/values/ic_launcher_background.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">' +
      BACKGROUND +
      '</color>\n</resources>\n'
  );

  // Use the project's installed Tauri CLI to encode actual multi-resolution ICO and ICNS.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zclaudia-icons-'));
  try {
    await fs.writeFile(
      path.join(temporary, 'app-icon.png'),
      outputs.get('apps/desktop/app-icon.png')
    );
    await fs.writeFile(
      path.join(temporary, 'favicon.png'),
      await sharp(Buffer.from(source), { density: 288 }).resize(1024, 1024).png().toBuffer()
    );
    const requireDesktop = createRequire(path.join(DESKTOP, 'package.json'));
    const cli = requireDesktop.resolve('@tauri-apps/cli/tauri.js');
    for (const name of ['app-icon', 'favicon']) {
      const destination = path.join(temporary, name);
      const result = spawnSync(
        process.execPath,
        [cli, 'icon', path.join(temporary, name + '.png'), '--output', destination],
        { cwd: DESKTOP, encoding: 'utf8' }
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error('Tauri icon failed: ' + (result.stderr || result.stdout));
    }
    put(
      ICONS + '/icon.icns',
      canonicalIcns(await fs.readFile(path.join(temporary, 'app-icon/icon.icns')))
    );
    put(ICONS + '/icon.ico', await fs.readFile(path.join(temporary, 'app-icon/icon.ico')));
    put(PUBLIC + '/favicon.ico', await fs.readFile(path.join(temporary, 'favicon/icon.ico')));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }

  const stale = [];
  for (const [relative, content] of outputs) {
    const destination = path.join(ROOT, relative);
    if (check) {
      const existing = await fs.readFile(destination).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!existing?.equals(content)) stale.push(relative);
    } else {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content);
    }
  }
  if (stale.length)
    throw new Error('Brand assets are out of date. Run pnpm icons:generate.\n' + stale.join('\n'));
  console.log((check ? 'Verified' : 'Generated') + ' ' + outputs.size + ' C2 brand assets.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
