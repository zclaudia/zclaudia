import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Runs an explicitly supplied, real Gateway artifact with private state. */
export class AgentRuntimeGatewayHarness {
  directory = '';
  url = '';
  logs = '';
  readonly secret = randomUUID();
  private child?: ChildProcess;

  async start() {
    const configured = process.env.ZCLAUDIA_E2E_GATEWAY_ENTRY;
    if (!configured)
      throw new Error('ZCLAUDIA_E2E_GATEWAY_ENTRY must identify a built Gateway v3 server module');
    const entry = path.resolve(configured);
    const bytes = await readFile(entry);
    this.directory = await mkdtemp(path.join(tmpdir(), 'zclaudia-gateway-e2e-'));
    await writeFile(
      path.join(this.directory, 'artifact.json'),
      JSON.stringify(
        {
          entry,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          protocol: 3,
        },
        null,
        2
      )
    );
    const launcher = path.join(this.directory, 'start.mjs');
    await writeFile(
      launcher,
      `
      import { createGatewayServer } from ${JSON.stringify(pathToFileURL(entry).href)};
      const server = createGatewayServer({ gatewaySecret: process.env.E2E_GATEWAY_SECRET,
        notificationConfig: { enabled: false } });
      server.listen(0, '127.0.0.1', () => console.log('E2E_GATEWAY_READY:' + server.address().port));
      process.once('SIGTERM', () => server.close(error => process.exit(error ? 1 : 0)));
    `
    );
    const child = spawn(process.execPath, [launcher], {
      cwd: this.directory,
      env: {
        PATH: '/usr/bin:/bin',
        NODE_ENV: 'test',
        ZCLAUDIA_DATA_DIR: path.join(this.directory, 'data'),
        E2E_GATEWAY_SECRET: this.secret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Gateway startup timed out')), 15000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.off('exit', exited);
        child.off('error', finish);
        if (error) reject(error);
        else resolve();
      };
      const exited = (code: number | null) =>
        finish(new Error(`Gateway exited (${code}): ${this.logs}`));
      const output = (data: Buffer) => {
        this.logs += data.toString().replaceAll(this.secret, '[redacted]');
        const ready = /E2E_GATEWAY_READY:(\d+)/.exec(this.logs);
        if (ready) {
          this.url = `ws://127.0.0.1:${ready[1]}`;
          finish();
        }
      };
      child.stdout!.on('data', output);
      child.stderr!.on('data', output);
      child.once('error', finish);
      child.once('exit', exited);
    });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Gateway did not stop within 10 seconds'));
      }, 10000);
      child.once('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Gateway stopped with code ${code}`));
      });
      child.kill('SIGTERM');
    });
    this.child = undefined;
  }

  async dispose() {
    try {
      await this.stop();
    } finally {
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    }
  }
}
