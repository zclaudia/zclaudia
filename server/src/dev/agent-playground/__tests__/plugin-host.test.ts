import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlaygroundPluginHost } from '../plugin-host.js';

const temporaryDirectories: string[] = [];

async function createFixture(response: string): Promise<string> {
  const pluginPath = await mkdtemp(path.join(os.tmpdir(), 'agent-playground-plugin-test-'));
  temporaryDirectories.push(pluginPath);
  await mkdir(path.join(pluginPath, 'dist'));
  await writeFile(path.join(pluginPath, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(
    path.join(pluginPath, 'plugin.json'),
    JSON.stringify({
      id: 'com.zclaudia.fixture',
      name: 'Fixture Agent',
      version: '1.0.0',
      main: 'dist/main.js',
      permissions: ['provider.register'],
      contributes: {
        agentRuntimes: [
          {
            type: 'fixture',
            label: 'Fixture',
            model: {
              kind: 'none',
              multimodalFallback: false,
              thinkingLevel: 'off',
            },
            hasCliPath: false,
            capabilities: {
              tools: 'none',
              providers: 'none',
              skills: 'none',
            },
            manifest: {
              id: 'fixture',
              name: 'Fixture',
              version: '1.0.0',
              apiVersion: 'pcp/v1',
              providerType: 'fixture',
              runtime: 'sdk',
              capabilities: [],
            },
          },
        ],
      },
    })
  );
  await writeFile(
    path.join(pluginPath, 'dist/main.js'),
    [
      "import { response } from './response.js';",
      'export function activate(context) {',
      '  context.agentRuntimes.register({',
      "    type: 'fixture',",
      '    async *run() {',
      "      yield { type: 'assistant_delta', content: response };",
      '    },',
      '  });',
      '}',
    ].join('\n')
  );
  await writeResponse(pluginPath, response);
  return pluginPath;
}

async function writeResponse(pluginPath: string, response: string): Promise<void> {
  await writeFile(
    path.join(pluginPath, 'dist/response.js'),
    `export const response = ${JSON.stringify(response)};\n`
  );
}

async function runFixture(host: PlaygroundPluginHost): Promise<string> {
  let output = '';
  for await (const event of host.runtimeAdapter.run(
    'hello',
    { cwd: host.pluginPath },
    async () => ({ behavior: 'deny' })
  )) {
    output += event.content ?? '';
  }
  return output;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});

describe('PlaygroundPluginHost', () => {
  it('loads changed transitive modules from a fresh snapshot on reload', async () => {
    const pluginPath = await createFixture('first');
    const host = new PlaygroundPluginHost({
      pluginPath,
      appVersion: 'test',
      emitLog: () => {},
    });

    await host.load();
    expect(await runFixture(host)).toBe('first');

    await writeResponse(pluginPath, 'second');
    await host.reload();
    expect(await runFixture(host)).toBe('second');

    await host.deactivate();
  });
});
