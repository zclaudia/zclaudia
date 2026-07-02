import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '../..');

test('manual chunk source paths point at existing desktop source directories', () => {
  const viteConfig = readFileSync(path.join(desktopRoot, 'vite.config.ts'), 'utf8');
  const sourcePaths = Array.from(viteConfig.matchAll(/id\.includes\('([^']*\/src\/[^']+\/)'\)/g))
    .map(match => match[1])
    .filter(sourcePath => !sourcePath.includes('node_modules'))
    .map(sourcePath => sourcePath.replace(/^.*\/src\//, 'src/'));

  assert.notEqual(sourcePaths.length, 0, 'expected vite.config.ts to declare source chunk paths');

  const missing = sourcePaths.filter(sourcePath => !existsSync(path.join(desktopRoot, sourcePath)));
  assert.deepEqual(missing, []);
});
