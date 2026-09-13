import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inventoryPlugin } from './artifact-integrity.mjs';
import { copyPortableDependencies } from './portable-dependencies.mjs';
import { prepareBundledCodexEngine } from './bundled-codex-engine.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimes = ['claude', 'codex', 'cursor'];

/**
 * Target platform for SDK engine resources, e.g. `--target-platform darwin-arm64`
 * (defaults to the building host). The dual-mode SDK engines are only staged for
 * this exact platform — a macOS build must never ship a Linux engine payload.
 */
function currentTargetPlatform() {
  const index = process.argv.indexOf('--target-platform');
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return `${process.platform}-${process.arch}`;
}

function stageClaudeSdkEngine(source, destination, targetPlatform) {
  // Claude: the engine binary ships inside the SDK's platform optional
  // package. Only the requested platform is pulled into the bundle; every
  // other platform package stays excluded (no blanket optional re-inclusion).
  const platformPackage = `@anthropic-ai/claude-agent-sdk-${targetPlatform}`;
  return copyPortableDependencies(source, path.join(destination, 'node_modules'), repoRoot, {
    includeOptional: [platformPackage],
  });
}

function findStagedClaudeEngine(destination, targetPlatform) {
  const binary = targetPlatform.startsWith('win32') ? 'claude.exe' : 'claude';
  const candidates = [
    path.join(
      destination,
      'node_modules',
      '@anthropic-ai',
      `claude-agent-sdk-${targetPlatform}`,
      binary
    ),
    path.join(
      destination,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
      'node_modules',
      '@anthropic-ai',
      `claude-agent-sdk-${targetPlatform}`,
      binary
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return path.relative(destination, candidate);
  }
  return null;
}

async function stageCodexEngine(source, destination, targetPlatform) {
  // Codex: the release pipeline stages the official runtime payload for the
  // target platform under <plugin>/engine/<platform>/. A pinned archive is
  // downloaded (or verified from cache) at build time. Missing resources or
  // verification failures fail the build; startup never fetches a replacement.
  const engineDestination = path.join(destination, 'engine', targetPlatform);
  const manifest = await prepareBundledCodexEngine(source, engineDestination, targetPlatform);
  // Digest over the full payload tree so the catalog can pin the artifact.
  const { inventoryPlugin } = await import('./artifact-integrity.mjs');
  const inventory = await inventoryPlugin(engineDestination);
  return {
    version: manifest.version,
    platform: targetPlatform,
    directory: path.relative(destination, engineDestination),
    treeSha256: inventory.treeSha256,
  };
}

/** Stage complete runtime modules beside server.mjs, never into a user's plugin store. */
export async function stageBuiltinAgents(
  outputRoot,
  { targetPlatform = currentTargetPlatform() } = {}
) {
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
    let runtimeEngines;
    if (runtime === 'claude') {
      // Use exact installed dependencies, without re-resolving version ranges.
      // Ship ordinary directories: Tauri omits pnpm directory symlinks.
      await stageClaudeSdkEngine(source, destination, targetPlatform);
      const engineExecutable = findStagedClaudeEngine(destination, targetPlatform);
      if (!engineExecutable) throw new Error(`Missing Claude SDK engine for ${targetPlatform}`);
      runtimeEngines = {
        sdk: {
          platform: targetPlatform,
          sdkPackage: packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk'],
          enginePackage: `@anthropic-ai/claude-agent-sdk-${targetPlatform}`,
          // Relative to the staged plugin dir; null when the platform package
          // was not installed at build time (SDK capability not deliverable).
          executable: engineExecutable,
        },
      };
    } else if (runtime === 'codex') {
      // The SDK-mode path throws the shared RuntimeContractError class, so the
      // plugin-sdk is a genuine runtime dependency of the bundle.
      await copyPortableDependencies(source, path.join(destination, 'node_modules'), repoRoot);
      const engine = await stageCodexEngine(source, destination, targetPlatform);
      if (engine) runtimeEngines = { engine };
    } else if (runtime === 'cursor') {
      // The ACP transport imports @agentclientprotocol/sdk at runtime and the
      // bundler externalizes production dependencies — vendor the installed
      // graph so a clean install never depends on hoisted node_modules
      // (Cursor ACP design doc §6.3).
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
      ...(runtimeEngines ? { runtimeEngines } : {}),
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
    console.log(
      'Usage: node scripts/plugins/stage-builtin-agents.mjs <output-directory> [--target-platform <platform-arch>]'
    );
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
