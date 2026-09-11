import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inventoryPlugin } from './artifact-integrity.mjs';

if (process.argv.includes('--help') || !process.argv[2]) {
  console.log('Usage: node scripts/plugins/verify-builtin-agents.mjs <builtin-plugins-directory>');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const root = path.resolve(process.argv[2]);
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
if (catalog.schemaVersion !== 1 || catalog.plugins?.length !== 3)
  throw new Error('Invalid built-in catalog');
for (const runtime of ['claude', 'codex', 'cursor']) {
  const entry = catalog.plugins.find(item => item.runtime === runtime);
  if (entry?.id !== `com.zclaudia.${runtime}` || entry.directory !== runtime)
    throw new Error(`Invalid catalog identity: ${runtime}`);
  const actual = await inventoryPlugin(path.join(root, runtime));
  if (actual.files.some(file => file.link))
    throw new Error(`Plugin resources contain links omitted by desktop packaging: ${runtime}`);
  if (
    actual.treeSha256 !== entry.treeSha256 ||
    JSON.stringify(actual.files) !== JSON.stringify(entry.files)
  )
    throw new Error(`Resource integrity mismatch: ${runtime}`);
  const manifest = JSON.parse(await readFile(path.join(root, runtime, 'plugin.json'), 'utf8'));
  if (manifest.id !== entry.id || manifest.version !== entry.version)
    throw new Error(`Manifest identity mismatch: ${runtime}`);
  console.log(`${entry.id}@${entry.version}: ${actual.files.length} resources verified`);
}
