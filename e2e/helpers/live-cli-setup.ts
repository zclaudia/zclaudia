import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRuntimeHarness } from './agent-runtime-harness';

const root = path.resolve(import.meta.dirname, '../..');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function prepareRecordedLiveCli(
  app: AgentRuntimeHarness,
  runtime: string,
  cliPath: string | undefined,
  selfTest: boolean,
  model?: string
) {
  let vendorCli = cliPath!;
  if (selfTest) {
    vendorCli = path.join(app.directory, `${runtime}-vendor-fixture`);
    await copyFile(
      path.join(root, 'e2e/fixtures/agent-runtimes', runtime, 'cli.mjs'),
      `${vendorCli}.mjs`
    );
    await copyFile(
      path.join(root, 'e2e/fixtures/agent-runtimes/mcp.mjs'),
      path.join(app.directory, 'mcp.mjs')
    );
    await writeFile(
      vendorCli,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(`${vendorCli}.mjs`)} "$@"\n`
    );
    await chmod(vendorCli, 0o755);
  }
  const shim = path.join(app.directory, `recorded-${runtime}-cli`);
  await copyFile(
    path.join(root, 'e2e/fixtures/agent-runtimes/live-cli-launcher.mjs'),
    `${shim}.mjs`
  );
  await writeFile(`${shim}.json`, JSON.stringify({ runtime, cliPath: vendorCli }), { mode: 0o600 });
  await writeFile(
    shim,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(`${shim}.mjs`)} ${quote(`${shim}.json`)} "$@"\n`
  );
  await chmod(shim, 0o755);
  const versionOutput = execFileSync(shim, ['--version'], {
    env: {
      ...app.runtimeEnvironment,
      E2E_RUNTIME_AUDIT: path.join(app.directory, 'cli-audit.jsonl'),
      PATH: '/usr/bin:/bin',
    },
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cliVersion = /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\s|$)/.exec(
    versionOutput
  )?.[1];
  if (!cliVersion) throw new Error(`Cannot identify ${runtime} CLI version`);
  const manifest = await readFile(path.join(root, 'plugins/agents', runtime, 'plugin.json'));
  const entry = await readFile(path.join(root, 'plugins/agents', runtime, 'dist/main.js'));
  return {
    shim,
    metadata: {
      runtime,
      cliVersion,
      cliSha256: createHash('sha256')
        .update(await readFile(vendorCli))
        .digest('hex'),
      sdkVersion:
        runtime === 'claude'
          ? JSON.parse(
              await readFile(
                path.join(
                  root,
                  'plugins/agents/claude/node_modules/@anthropic-ai/claude-agent-sdk/package.json'
                ),
                'utf8'
              )
            ).version
          : null,
      requestedModel: model ?? null,
      plugin: {
        version: JSON.parse(manifest.toString()).version,
        manifestSha256: createHash('sha256').update(manifest).digest('hex'),
        entrySha256: createHash('sha256').update(entry).digest('hex'),
      },
    },
  };
}
