import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeCompatibility } from './runtime-compatibility.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function checkImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      await checkImports(filename);
      continue;
    }
    if (!/\.(ts|mjs|js)$/.test(filename)) continue;
    const source = await readFile(filename, 'utf8');
    if (
      /['"]@zclaudia\/(?:shared|server)(?:\/[^'"]*)?['"]/.test(source) ||
      /(?:from\s*|import\s*\()['"][^'"]*\/server\/src\//.test(source)
    ) {
      throw new Error(`Agent plugin must use public SDK contracts: ${filename}`);
    }
  }
}
for (const runtime of ['claude', 'codex', 'cursor']) {
  const directory = path.join(repoRoot, 'plugins/agents', runtime);
  const manifest = JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (
    manifest.id !== `com.zclaudia.${runtime}` ||
    pkg.name !== `@zclaudia/plugin-${runtime}` ||
    pkg.version !== manifest.version ||
    manifest.contributes.agentRuntimes[0].type !== runtime
  ) {
    throw new Error(`Inconsistent identity or version: ${directory}`);
  }
  validateRuntimeCompatibility(
    JSON.parse(await readFile(path.join(directory, 'runtime-compatibility.json'), 'utf8')),
    runtime
  );
  await checkImports(directory);
}
await checkImports(path.join(repoRoot, 'packages/agent-common'));
console.log('Built-in agent package boundaries and manifests passed.');
