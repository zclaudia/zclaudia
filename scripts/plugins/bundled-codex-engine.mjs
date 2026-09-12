import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { inventoryPlugin } from './artifact-integrity.mjs';
import { validateRuntimeCompatibility } from './runtime-compatibility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function selectBundledCodexArtifact(config, platform) {
  validateRuntimeCompatibility(config, 'codex');
  const version = config.bundledRuntime?.version;
  if (!version) throw new Error('Codex bundledRuntime.version must be pinned');
  const artifact = config.managedInstall?.versions.find(v => v.version === version)?.artifacts[
    platform
  ];
  if (!artifact) throw new Error(`No pinned Codex artifact for ${version}/${platform}`);
  return { version, artifact };
}

// Reuse the host's bounded archive parser (rejects traversal, links and bombs).
// Bundle only this module in memory; release scripts remain ordinary Node ESM.
let archiveModule;
async function extractor() {
  archiveModule ??= build({
    entryPoints: [path.join(root, 'server/src/application/managed-runtimes/archive.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  }).then(
    result =>
      import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
      )
  );
  return archiveModule;
}

/** Build/release only. Runtime startup never downloads an engine. */
export async function prepareBundledCodexEngine(pluginDir, destination, platform, options = {}) {
  const config = JSON.parse(
    await readFile(path.join(pluginDir, 'runtime-compatibility.json'), 'utf8')
  );
  const { version, artifact } = selectBundledCodexArtifact(config, platform);
  const { extractManagedRuntimeArtifact, MANAGED_RUNTIME_LIMITS } = await extractor();
  const cacheDir = options.cacheDir ?? path.join(root, '.cache/runtime-artifacts');
  await mkdir(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, `${artifact.sha256}.archive`);
  let bytes = existsSync(archivePath) ? await readFile(archivePath) : undefined;
  if (bytes && digest(bytes) !== artifact.sha256)
    throw new Error('Cached Codex archive SHA-256 mismatch');
  if (!bytes) {
    const response = await (options.fetchImpl ?? fetch)(artifact.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Codex download failed: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MANAGED_RUNTIME_LIMITS.archiveSize)
        throw new Error('Codex archive exceeds size limit');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (digest(bytes) !== artifact.sha256)
      throw new Error('Downloaded Codex archive SHA-256 mismatch');
    const temporary = `${archivePath}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, archivePath);
  }
  if (artifact.size && bytes.length !== artifact.size)
    throw new Error('Codex archive size mismatch');

  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), '.codex-engine-'));
  try {
    const executable = await extractManagedRuntimeArtifact({
      archivePath,
      archiveFormat: artifact.archiveFormat,
      destination: staging,
      executablePath: artifact.executablePath,
    });
    if (platform === `${process.platform}-${process.arch}`) {
      const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000 });
      if (output.trim() !== `codex-cli ${version}`)
        throw new Error(`Unexpected Codex version: ${output.trim()}`);
      // Check the shipped engine, not whichever version happens to be in PATH.
      execFileSync(
        process.execPath,
        [path.join(pluginDir, 'scripts/check-app-server-protocol.mjs')],
        {
          env: { ...process.env, CODEX_CLI_PATH: executable },
          timeout: 30_000,
          stdio: 'pipe',
          cwd: tmpdir(),
        }
      );
    }
    const inventory = await inventoryPlugin(staging);
    const manifest = {
      version,
      platform,
      archiveSha256: artifact.sha256,
      executablePath: artifact.executablePath,
      executableSha256: digest(await readFile(executable)),
      payloadTreeSha256: inventory.treeSha256,
    };
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2] ?? `${process.platform}-${process.arch}`;
  const plugin = path.join(root, 'plugins/agents/codex');
  console.log(
    await prepareBundledCodexEngine(plugin, path.join(plugin, 'engine', platform), platform)
  );
}
