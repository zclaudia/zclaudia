import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedLegacyData } from '../fixtures/agent-runtime-migration/seed.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class AgentRuntimeHarness {
  directory = '';
  url = '';
  logs = '';
  private child?: ChildProcess;
  legacyData = false;
  // Only the test launcher selects an entry; production discovery is unchanged.
  serverEntry?: string;
  browserDist?: string;
  // Explicit test-account environment for the separate opt-in live runner.
  // Normal deterministic tests keep this empty and never inherit credentials.
  runtimeEnvironment: Record<string, string> = {};

  async start(options: { waitForReady?: boolean } = {}): Promise<void> {
    if (!this.directory) {
      this.directory = await realpath(await mkdtemp(path.join(tmpdir(), 'zclaudia-agent-e2e-')));
      if (this.legacyData) await seedLegacyData(this.directory);
    }
    await mkdir(path.join(this.directory, 'workspace'), { recursive: true });
    const nodePath = process.env.ZCLAUDIA_E2E_NODE_PATH ?? process.execPath;
    const entry =
      this.serverEntry ??
      process.env.ZCLAUDIA_E2E_SERVER_ENTRY ??
      path.join(repoRoot, 'server/dist/index.js');
    const sandboxProfile = process.env.ZCLAUDIA_E2E_SANDBOX_PROFILE;
    const child = spawn(
      sandboxProfile ? '/usr/bin/sandbox-exec' : nodePath,
      sandboxProfile ? ['-f', sandboxProfile, nodePath, entry] : [entry],
      {
        cwd: this.directory,
        env: {
          ...this.runtimeEnvironment,
          PATH: [
            path.join(this.directory, 'bin'),
            process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin',
          ]
            .filter(Boolean)
            .join(path.delimiter),
          // Keep the OS environment intact; provider config has its own explicit root.
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          PORT: '0',
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          ZCLAUDIA_DATA_DIR: path.join(this.directory, 'data'),
          ZCLAUDIA_AGENT_CONFIG_ROOT:
            this.runtimeEnvironment.ZCLAUDIA_AGENT_CONFIG_ROOT ??
            path.join(this.directory, 'provider-config'),
          E2E_RUNTIME_AUDIT: path.join(this.directory, 'cli-audit.jsonl'),
          ...((this.browserDist ?? process.env.ZCLAUDIA_E2E_BROWSER_DIST)
            ? { ZCLAUDIA_BROWSER_DIST: this.browserDist ?? process.env.ZCLAUDIA_E2E_BROWSER_DIST }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    this.child = child;
    let output = '';
    const append = (chunk: Buffer) => {
      this.logs += chunk.toString();
      output += chunk.toString();
    };
    child.stdout!.on('data', append);
    child.stderr!.on('data', append);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Server did not become ready')), 30_000);
      const onExit = (code: number | null) =>
        finish(new Error(`Server exited during startup (${code}): ${output.slice(-5000)}`));
      const onData = () => {
        const match = (
          options.waitForReady === false ? /SERVER_LISTENING:(\d+)/ : /SERVER_READY:(\d+)/
        ).exec(output);
        if (match) {
          this.url = `http://127.0.0.1:${match[1]}`;
          finish();
        }
      };
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        child.off('exit', onExit);
        child.stdout!.off('data', onData);
        if (error) reject(error);
        else resolve();
      };
      child.once('error', finish);
      child.once('exit', onExit);
      child.stdout!.on('data', onData);
    });
    if (options.waitForReady !== false) await this.api('/api/plugins');
  }

  async api<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(`${options.method ?? 'GET'} ${endpoint}: ${JSON.stringify(payload)}`);
    }
    return payload.data as T;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const deadline = Date.now() + 10_000;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined;
      await this.assertFixtureProcessesStopped();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Server did not shut down within 10 seconds'));
      }, 10_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.child = undefined;
    await this.assertFixtureProcessesStopped(Math.max(0, deadline - Date.now()));
  }

  async assertFixtureProcessesStopped(graceMs = 2000): Promise<void> {
    let records: Array<Record<string, any>>;
    try {
      records = await this.audit();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const pids = [
      ...new Set(
        records
          .map(record => record.pid)
          .filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid)
      ),
    ];
    const groups =
      process.platform === 'win32'
        ? []
        : [
            ...new Set(
              records
                .map(record => record.processGroup)
                .filter(group => Number.isSafeInteger(group) && group > 0 && group !== process.pid)
            ),
          ];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    };
    const deadline = Date.now() + graceMs;
    while ((pids.some(alive) || groups.some(group => alive(-group))) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 50));
    const leaked = pids.filter(alive);
    const leakedGroups = groups.filter(group => alive(-group));
    // These PIDs were emitted by this harness's own fixture processes. Reap
    // leaks before deleting their workspace, and still fail the acceptance test.
    for (const pid of leaked) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* The process may have exited between the liveness check and kill. */
      }
    }
    for (const group of leakedGroups) {
      try {
        process.kill(-group, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }
    if (leaked.length || leakedGroups.length)
      throw new Error(
        `Test CLI processes survived server shutdown: ${leaked.join(', ')}; groups: ${leakedGroups.join(', ')}`
      );
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async crash(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null)
      throw new Error('No live backend to crash');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Backend did not exit after SIGKILL')),
        5000
      );
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGKILL');
    });
    this.child = undefined;
    // SIGKILL cannot execute application cleanup. The harness owns and reaps
    // its fixture processes before restart; this is not a graceful-exit claim.
    const pids = new Set(
      (await this.audit())
        .map(record => record.pid)
        .filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid)
    );
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    await this.assertFixtureProcessesStopped();
  }

  async configureCodingProject(
    runtime: string,
    page?: Page,
    suffix = '',
    explicitCliPath?: string
  ) {
    const cwd = path.join(this.directory, 'workspace', runtime + suffix);
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, 'add.mjs'), 'export const add = (a, b) => a - b;\n');
    await writeFile(
      path.join(cwd, 'add.test.mjs'),
      "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { add } from './add.mjs'; test('addition', () => assert.equal(add(2, 3), 5));\n"
    );
    const cliPath = explicitCliPath ?? path.join(this.directory, `${runtime}-fixture`);
    if (!explicitCliPath) {
      const fixture = await readFile(
        path.join(repoRoot, 'e2e/fixtures/agent-runtimes', runtime, 'cli.mjs'),
        'utf8'
      );
      // A shebang cannot safely contain a path with spaces. Invoke the copied
      // Node through a tiny shell launcher for both source and artifact runs.
      const cliScript = `${cliPath}.mjs`;
      await writeFile(cliScript, fixture);
      await writeFile(
        path.join(this.directory, 'mcp.mjs'),
        await readFile(path.join(repoRoot, 'e2e/fixtures/agent-runtimes/mcp.mjs'))
      );
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      await writeFile(
        cliPath,
        `#!/bin/sh\nexec ${quote(process.env.ZCLAUDIA_E2E_NODE_PATH ?? process.execPath)} ${quote(cliScript)} "$@"\n`
      );
      await chmod(cliPath, 0o755);
    }
    const profile = (await this.api('/api/agent-profiles')).find(
      (p: any) => p.runtimeType === runtime
    );
    expect(profile).toBeTruthy();
    await this.api(`/api/agent-profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cliPath }),
    });
    let project;
    if (page) {
      await page.goto(this.url);
      await page.getByRole('button', { name: /This Device/ }).hover();
      await page.getByRole('button', { name: 'New project', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
      await dialog.getByPlaceholder('Project name').fill(`${runtime} E2E Project${suffix}`);
      await dialog.getByLabel('Working directory', { exact: true }).fill(cwd);
      await dialog.getByLabel('Project coding agent', { exact: true }).click();
      await page.getByRole('option', { name: profile.name, exact: true }).click();
      const created = page.waitForResponse(
        response =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/projects'
      );
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      const response = await created;
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      project = payload.data;
      expect(project.defaultAgentProfileId).toBe(profile.id);
      await expect(dialog).toHaveCount(0);
    } else {
      project = await this.api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `${runtime} E2E Project${suffix}`,
          rootPath: cwd,
          defaultAgentProfileId: profile.id,
        }),
      });
    }
    const session = await this.api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        name: `${runtime} E2E Session${suffix}`,
        agentProfileId: profile.id,
      }),
    });
    return { project, session, profile, cwd };
  }

  async audit(): Promise<Array<Record<string, any>>> {
    return (await readFile(path.join(this.directory, 'cli-audit.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  async saveAudit(filename: string): Promise<void> {
    try {
      await writeFile(filename, JSON.stringify(await this.audit(), null, 2));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.stop();
    } finally {
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    }
  }
}

export const test = base.extend<{ app: AgentRuntimeHarness; legacyData: boolean }>({
  legacyData: [false, { option: true }],
  app: async ({ browserName: _browserName, legacyData }, use, testInfo) => {
    const app = new AgentRuntimeHarness();
    app.legacyData = legacyData;
    try {
      await app.start();
      await use(app);
    } finally {
      try {
        await app.stop();
        await app.saveAudit(testInfo.outputPath('cli-audit.json'));
      } finally {
        try {
          await app.dispose();
        } finally {
          await writeFile(testInfo.outputPath('server.log'), app.logs);
        }
      }
    }
  },
});
export { expect };

export async function openCodingSession(
  page: Page,
  app: AgentRuntimeHarness,
  project: { name: string },
  session: { name: string }
) {
  await page.goto(app.url);
  await page.getByText(project.name, { exact: true }).click();
  await page.getByTestId('session-item').getByText(session.name, { exact: true }).click();
  await expect(page.getByTestId('message-input')).toBeEditable();
}

export async function sendCodingMessage(page: Page, text: string) {
  await page.getByTestId('message-input').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
