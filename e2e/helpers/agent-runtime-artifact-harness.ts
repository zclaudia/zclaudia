import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntimeHarness } from './agent-runtime-harness';

export const test = base.extend<{ artifactApp: AgentRuntimeHarness; bundle: string }>({
  artifactApp: async ({ browserName: _browserName }, use, testInfo) => {
    if (process.env.ZCLAUDIA_E2E_SANDBOX_PROFILE)
      throw new Error('Mutable artifact tests must run separately from immutable bundle tests');
    const app = new AgentRuntimeHarness();
    app.directory = await realpath(await mkdtemp(path.join(tmpdir(), 'zclaudia-artifact-')));
    const source = path.resolve(process.env.ZCLAUDIA_E2E_MUTABLE_ARTIFACT_DIR ?? 'server/bundle');
    const bundle = path.join(app.directory, 'resources');
    const verifyOriginal = () =>
      execFileSync(
        process.execPath,
        [
          path.resolve('scripts/plugins/verify-builtin-agents.mjs'),
          path.join(source, 'builtin-plugins'),
        ],
        { stdio: 'pipe' }
      );
    try {
      verifyOriginal();
      const serverSha256 = createHash('sha256')
        .update(await readFile(path.join(source, 'server.mjs')))
        .digest('hex');
      const catalog = JSON.parse(
        await readFile(path.join(source, 'builtin-plugins/catalog.json'), 'utf8')
      );
      await writeFile(
        testInfo.outputPath('baseline-artifact.json'),
        JSON.stringify(
          {
            mode: 'mutable-artifact-fixtures',
            serverSha256,
            sourceCommit: catalog.sourceCommit,
            sourceDirty: catalog.sourceDirty,
            plugins: catalog.plugins.map(({ id, version, treeSha256 }: any) => ({
              id,
              version,
              treeSha256,
            })),
          },
          null,
          2
        )
      );
      // Missing artifacts fail the suite; never silently skip a release check.
      await cp(source, bundle, { recursive: true });
      app.serverEntry = path.join(bundle, 'server.mjs');
      app.browserDist = path.resolve('apps/desktop/dist');
      await use(app);
    } finally {
      try {
        await app.stop();
        await app.saveAudit(testInfo.outputPath('cli-audit.json'));
      } finally {
        try {
          await writeFile(testInfo.outputPath('server.log'), app.logs);
          await app.dispose();
        } finally {
          verifyOriginal();
        }
      }
    }
  },
  bundle: async ({ artifactApp }, use) => {
    await use(path.dirname(artifactApp.serverEntry!));
  },
});
export { expect };
