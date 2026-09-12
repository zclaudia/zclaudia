import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBundledRuntimeResourceFromPluginDir } from '../bundled-runtime-resources.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('bundled Codex verification', () => {
  it('requires a manifest and rejects a changed executable or version', () => {
    vi.stubEnv('ZCLAUDIA_BUNDLED_CODEX_ENGINE_EXECUTABLE', '');
    const root = mkdtempSync(path.join(tmpdir(), 'codex-resource-'));
    dirs.push(root);
    const platform = `${process.platform}-${process.arch}`;
    const executablePath = process.platform === 'win32' ? 'bin/codex.exe' : 'bin/codex';
    const engine = path.join(root, 'engine', platform);
    mkdirSync(path.join(engine, 'bin'), { recursive: true });
    const executable = path.join(engine, executablePath);
    writeFileSync(executable, 'synthetic engine');
    writeFileSync(
      path.join(root, 'runtime-compatibility.json'),
      JSON.stringify({
        bundledRuntime: { version: '1.0.0' },
        managedInstall: {
          versions: [
            {
              version: '1.0.0',
              artifacts: { [platform]: { sha256: 'archive-digest', executablePath } },
            },
          ],
        },
      })
    );
    const resolve = () => resolveBundledRuntimeResourceFromPluginDir('codex', root);
    expect(resolve().available).toBe(false);
    const manifest = {
      version: '1.0.0',
      platform,
      archiveSha256: 'archive-digest',
      executablePath,
      executableSha256: createHash('sha256').update('synthetic engine').digest('hex'),
    };
    writeFileSync(path.join(engine, 'manifest.json'), JSON.stringify(manifest));
    expect(resolve()).toMatchObject({
      available: true,
      executablePath: executable,
      version: '1.0.0',
    });
    writeFileSync(
      path.join(engine, 'manifest.json'),
      JSON.stringify({ ...manifest, version: '2.0.0' })
    );
    expect(resolve().available).toBe(false);
    writeFileSync(path.join(engine, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(executable, 'changed engine');
    expect(resolve().available).toBe(false);
  });
});
