#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const agent = process.argv[2];
if (!agent || !/^[a-z0-9-]+$/.test(agent)) {
  console.error('Usage: node scripts/plugins/build-agent.mjs <agent> [--watch]');
  process.exit(2);
}

const agentRoot = path.join(repoRoot, 'plugins', 'agents', agent);
const packageJson = JSON.parse(await readFile(path.join(agentRoot, 'package.json'), 'utf8'));
const external = Object.keys(packageJson.dependencies ?? {}).filter(
  dependency => dependency !== '@zclaudia/agent-common'
);

await rm(path.join(agentRoot, 'dist', 'main.js'), { force: true });
await rm(path.join(agentRoot, 'dist', 'main.js.map'), { force: true });
const options = {
  absWorkingDir: repoRoot,
  entryPoints: [path.join(agentRoot, 'src', 'main.ts')],
  outfile: path.join(agentRoot, 'dist', 'main.js'),
  bundle: true,
  external,
  format: 'esm',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
};
if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
