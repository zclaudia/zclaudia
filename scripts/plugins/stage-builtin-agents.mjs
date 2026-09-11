import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { inventoryPlugin } from './artifact-integrity.mjs';
import { copyPortableDependencies } from './portable-dependencies.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimes = ['claude', 'codex', 'cursor'];

/** Stage complete runtime modules beside server.mjs, never into a user's plugin store. */
export async function stageBuiltinAgents(outputRoot) {
  const output = path.resolve(outputRoot);
  const records = [];
  await mkdir(output, { recursive: true });
  for (const runtime of runtimes) {
    const source = path.join(repoRoot, 'plugins', 'agents', runtime);
    const destination = path.join(output, runtime);
    const manifest = JSON.parse(await readFile(path.join(source, 'plugin.json'), 'utf8'));
    const packageJson = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.join(destination, 'dist'), { recursive: true });
    for (const filename of [
      'plugin.json',
      'runtime-compatibility.json',
      'LICENSE',
      'README.md',
      'dist/main.js',
    ]) {
      await cp(path.join(source, filename), path.join(destination, filename));
    }
    if (runtime === 'claude') {
      // Use exact installed dependencies, without re-resolving version ranges.
      // Ship ordinary directories: Tauri omits pnpm directory symlinks.
      await copyPortableDependencies(source, path.join(destination, 'node_modules'), repoRoot);
    }
    await writeFile(
      path.join(destination, 'package.json'),
      JSON.stringify(
        {
          name: packageJson.name,
          version: packageJson.version,
          type: 'module',
          private: true,
          main: './dist/main.js',
          license: packageJson.license,
        },
        null,
        2
      ) + '\n'
    );
    // Import from the staged directory in a clean child process. This catches
    // missing SDK dependencies and relative compatibility assets before signing.
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(pathToFileURL(path.join(destination, 'dist/main.js')).href)}); if (typeof m.activate !== 'function') process.exit(1);`,
      ],
      { cwd: tmpdir(), stdio: 'pipe' }
    );
    records.push({
      id: manifest.id,
      runtime,
      directory: runtime,
      version: manifest.version,
      ...(await inventoryPlugin(destination)),
    });
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const sourceDirty =
    execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()
      .length > 0;
  await writeFile(
    path.join(output, 'catalog.json'),
    JSON.stringify({ schemaVersion: 1, sourceCommit, sourceDirty, plugins: records }, null, 2) +
      '\n'
  );
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || process.argv.includes('--help')) {
    console.log('Usage: node scripts/plugins/stage-builtin-agents.mjs <output-directory>');
    process.exit(process.argv.includes('--help') ? 0 : 2);
  }
  console.log(
    JSON.stringify(
      (await stageBuiltinAgents(process.argv[2])).map(({ files, dependencies, ...summary }) => ({
        ...summary,
        fileCount: files.length,
        dependencyCount: dependencies.length,
      })),
      null,
      2
    )
  );
}
