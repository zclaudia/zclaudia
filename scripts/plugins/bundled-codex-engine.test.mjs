import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareBundledCodexEngine, selectBundledCodexArtifact } from './bundled-codex-engine.mjs';

const config = JSON.parse(
  await readFile(
    new URL('../../plugins/agents/codex/runtime-compatibility.json', import.meta.url),
    'utf8'
  )
);

test('bundled version is independent of the external managed CLI recommendation', () => {
  assert.equal(selectBundledCodexArtifact(config, 'darwin-arm64').version, '0.154.0');
  assert.throws(
    () => selectBundledCodexArtifact({ ...config, bundledRuntime: undefined }, 'darwin-arm64'),
    /pinned/
  );
  assert.throws(() => selectBundledCodexArtifact(config, 'unknown-platform'), /No pinned/);
});

test('verifies downloads and cache before staging, rejects corrupted resources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bundled-codex-test-'));
  try {
    const bytes = Buffer.from('synthetic cross-platform engine');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const platform = process.platform === 'linux' ? 'darwin-arm64' : 'linux-arm64';
    const fixture = structuredClone(config);
    fixture.managedInstall.recommendedVersion = fixture.bundledRuntime.version;
    fixture.managedInstall.versions = [
      {
        version: fixture.bundledRuntime.version,
        artifacts: {
          [platform]: {
            url: 'https://example.invalid/engine',
            archiveFormat: 'raw',
            executablePath: 'bin/codex',
            sha256,
            size: bytes.length,
          },
        },
      },
    ];
    const plugin = path.join(root, 'plugin');
    await mkdir(plugin);
    await writeFile(path.join(plugin, 'runtime-compatibility.json'), JSON.stringify(fixture));
    const cacheDir = path.join(root, 'cache');
    const destination = path.join(root, 'output');
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response(bytes);
    };
    const manifest = await prepareBundledCodexEngine(plugin, destination, platform, {
      fetchImpl,
      cacheDir,
    });
    assert.equal(manifest.executableSha256, sha256);
    assert.deepEqual(await readFile(path.join(destination, 'bin/codex')), bytes);
    await prepareBundledCodexEngine(plugin, destination, platform, { fetchImpl, cacheDir });
    assert.equal(calls, 1);
    await writeFile(path.join(cacheDir, `${sha256}.archive`), 'corrupted');
    await assert.rejects(
      prepareBundledCodexEngine(plugin, destination, platform, { fetchImpl, cacheDir }),
      /SHA-256 mismatch/
    );
    await rm(cacheDir, { recursive: true });
    await assert.rejects(
      prepareBundledCodexEngine(plugin, destination, platform, {
        fetchImpl: async () => new Response('wrong'),
        cacheDir,
      }),
      /SHA-256 mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
