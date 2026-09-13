import { describe, expect, it, vi } from 'vitest';
import type { Dirent } from 'fs';
import type { RuntimeDiscoveryContext, RuntimeInvocableRecord } from '@zclaudia/shared/providers';
import { createClaudeInvocations } from '../../../../../plugins/agents/claude/src/invocations.js';
import { createCodexInvocations } from '../../../../../plugins/agents/codex/src/invocations.js';
import { createCursorInvocations } from '../../../../../plugins/agents/cursor/src/invocations.js';
import { createPiInvocations } from '../../../infra/providers/pi-runtime/invocations.js';

/**
 * Phase 4 exit criterion (design doc §24.5 / §22): "Claude, Codex, Cursor, and
 * Pi return meaningfully different catalogs for the same project." Each
 * runtime surfaces a different invocable kind, execution transport, fidelity
 * tier, and scope mix for the SAME working directory.
 */

const CONTEXT: RuntimeDiscoveryContext = {
  runtimeType: 'claude',
  engineMode: 'cli',
  adapterVersion: '1',
  canonicalCwd: '/repo',
  configurationRoots: ['/repo'],
  settingsSourcePolicy: ['user', 'project'],
  configurationRootFingerprint: 'cfg',
};

async function discoverClaude(): Promise<RuntimeInvocableRecord[]> {
  const tree: Record<string, string> = {
    '/home/example/.claude/commands/review.md': '---\ndescription: Review\n---\nbody',
    '/repo/.claude/commands/deploy.md': 'Deploy',
  };
  const readdir = vi.fn(async (dir: string): Promise<Dirent[]> => {
    const base = dir.replace(/\/+$/, '') + '/';
    const direct = new Map<string, { file: boolean; dir: boolean }>();
    for (const key of Object.keys(tree)) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      const [head, ...tail] = rest.split('/');
      const entry = direct.get(head) ?? { file: false, dir: false };
      direct.set(head, tail.length > 0 ? { ...entry, dir: true } : { ...entry, file: true });
    }
    return [...direct.entries()].map(
      ([name, kind]) =>
        ({ name, isFile: () => kind.file, isDirectory: () => kind.dir }) as unknown as Dirent
    );
  });
  const readFile = vi.fn(async (file: string) => {
    const content = tree[file];
    if (content === undefined) throw new Error('ENOENT');
    return content;
  });
  const provider = createClaudeInvocations({
    home: '/home/example',
    readdir,
    readFile,
    realpath: async p => p,
  });
  return (await provider.discover(CONTEXT, new AbortController().signal)).items;
}

async function discoverCodex(): Promise<RuntimeInvocableRecord[]> {
  const provider = createCodexInvocations({
    getClient: async () => ({
      listSkills: async () => [
        {
          name: 'my-stocks',
          description: 'A-share research',
          path: '/Users/example/.codex/skills/my-stocks/SKILL.md',
          scope: 'user',
          enabled: true,
        },
      ],
    }),
  });
  return (await provider.discover(CONTEXT, new AbortController().signal)).items;
}

async function discoverCursor(): Promise<RuntimeInvocableRecord[]> {
  const provider = createCursorInvocations({
    newClient: async () => {
      let sink:
        | ((update: {
            sessionUpdate: string;
            availableCommands?: Array<{ name: string; description?: string }>;
          }) => void)
        | undefined;
      const client = {
        onUpdate: (cb: typeof sink) => {
          sink = cb;
        },
        newSession: async () => {
          sink?.({
            sessionUpdate: 'available_commands_update',
            availableCommands: [{ name: 'multi-model-review', description: 'Review widely' }],
          });
        },
        close: async () => {},
      };
      return client;
    },
    delay: async () => {},
  });
  return (await provider.discover(CONTEXT, new AbortController().signal)).items;
}

async function discoverPi(): Promise<RuntimeInvocableRecord[]> {
  const provider = createPiInvocations({
    listSkills: () => [
      {
        id: 'release-notes',
        name: 'Release Notes',
        description: 'Notes',
        source: 'workspace',
        eligible: true,
      },
    ],
  });
  return (await provider.discover(CONTEXT, new AbortController().signal)).items;
}

describe('four runtimes return meaningfully different catalogs (Phase 4 exit)', () => {
  it('each runtime yields its documented kind / transport / fidelity / trigger mix', async () => {
    const [claude, codex, cursor, pi] = await Promise.all([
      discoverClaude(),
      discoverCodex(),
      discoverCursor(),
      discoverPi(),
    ]);

    // Claude: filesystem commands, native-text, exact, project+user scopes.
    expect(claude.map(i => i.descriptor.execution)).toEqual(
      expect.arrayContaining([expect.objectContaining({ mode: 'native-text', fidelity: 'exact' })])
    );
    expect(new Set(claude.map(i => i.descriptor.origin.scope))).toEqual(
      new Set(['project', 'user'])
    );

    // Codex: App Server skills, native-structured, exact.
    expect(codex[0].descriptor).toMatchObject({
      kind: 'runtime.skill',
      execution: { mode: 'native-structured', fidelity: 'exact' },
    });

    // Cursor: ACP-advertised commands, emulated, best-effort.
    expect(cursor[0].descriptor).toMatchObject({
      kind: 'runtime.command',
      execution: { mode: 'emulated', fidelity: 'best-effort' },
    });

    // Pi: portable skills under /skill:, bridged, exact.
    expect(pi[0].descriptor).toMatchObject({
      kind: 'portable.skill',
      displayTrigger: '/skill:release-notes',
      execution: { mode: 'bridged', fidelity: 'exact' },
    });
  });

  it('no two runtimes share the same kind + transport signature', async () => {
    const [claude, codex, cursor, pi] = await Promise.all([
      discoverClaude(),
      discoverCodex(),
      discoverCursor(),
      discoverPi(),
    ]);
    const signatures = [claude, codex, cursor, pi].map(records =>
      records
        .map(r => `${r.descriptor.kind}:${r.descriptor.execution.mode}`)
        .sort()
        .join('|')
    );
    expect(new Set(signatures).size).toBe(4);
  });
});
