import { describe, expect, it, vi } from 'vitest';
import type { Dirent } from 'fs';
import type {
  PortableSkillCandidate,
  RuntimeDiscoveryContext,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/plugin-sdk/invocations';
import { createClaudeInvocations, MAX_COMMAND_ENTRIES } from '../invocations.js';

const HOME = '/home/example';

function dirent(name: string, isFile = true, isDirectory = false): Dirent {
  return { name, isFile: () => isFile, isDirectory: () => isDirectory } as unknown as Dirent;
}

function makeDeps(tree: Record<string, string>) {
  const readdir = vi.fn(async (dir: string): Promise<Dirent[]> => {
    const base = dir.replace(/\/+$/, '') + '/';
    const direct = new Map<string, { file: boolean; dir: boolean }>();
    for (const key of Object.keys(tree)) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      const [head, ...tail] = rest.split('/');
      const existing = direct.get(head) ?? { file: false, dir: false };
      if (tail.length > 0) direct.set(head, { ...existing, dir: true });
      else direct.set(head, { ...existing, file: true });
    }
    return [...direct.entries()].map(([name, kind]) => dirent(name, kind.file, kind.dir));
  });
  const readFile = vi.fn(async (file: string): Promise<string> => {
    const content = tree[file];
    if (content === undefined) throw new Error('ENOENT');
    return content;
  });
  const realpath = vi.fn(async (p: string) => p);
  const provider = createClaudeInvocations({ home: HOME, readdir, readFile, realpath });
  return { provider, readdir, readFile };
}

const CONTEXT: RuntimeDiscoveryContext = {
  runtimeType: 'claude',
  engineMode: 'cli',
  adapterVersion: '1',
  canonicalCwd: '/repo',
  configurationRoots: ['/repo'],
  settingsSourcePolicy: ['user', 'project'],
  configurationRootFingerprint: 'cfg',
};

const SKILL_TREE = {
  [`${HOME}/.claude/commands/review.md`]:
    '---\ndescription: Review the current diff\n---\nReview body',
  [`${HOME}/.claude/commands/frontend/component.md`]: '# Component audit',
  ['/repo/.claude/commands/deploy.md']: 'Deploy steps',
};

describe('Claude invocations provider (URIP §14.1, §24.4)', () => {
  it('declares a filesystem catalog with native-text execution', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const capabilities = await provider.capabilities(CONTEXT);
    expect(capabilities).toMatchObject({
      catalog: 'filesystem',
      executionModes: ['native-text'],
      portableSkills: 'emulated',
    });
  });

  it('reproduces Claude command roots with directory namespaces and both scopes', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    const triggers = catalog.items.map(i => i.descriptor.displayTrigger).sort();
    expect(triggers).toEqual(['/deploy', '/frontend:component', '/review']);
    const scopes = Object.fromEntries(
      catalog.items.map(i => [i.descriptor.displayTrigger, i.descriptor.origin.scope])
    );
    expect(scopes['/deploy']).toBe('project');
    expect(scopes['/review']).toBe('user');
    // Native-text with exact fidelity — never emulated for Claude commands.
    for (const item of catalog.items) {
      expect(item.descriptor.execution).toMatchObject({ mode: 'native-text', fidelity: 'exact' });
    }
  });

  it('extracts untrusted frontmatter descriptions with a bound', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    const review = catalog.items.find(i => i.descriptor.displayTrigger === '/review');
    expect(review?.descriptor.description).toBe('Review the current diff');
  });

  it('descriptors carry no absolute paths; digests live on the private record', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    for (const record of catalog.items) {
      const descriptorJson = JSON.stringify(record.descriptor);
      expect(descriptorJson).not.toContain('/home/example');
      expect(descriptorJson).not.toContain('/repo/.claude');
      expect(record.nativeLocator).toMatchObject({ type: 'claude-command' });
      expect(record.contentDigest).toBeTruthy();
    }
  });

  it('IDs stay stable across unchanged scans', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const a = await provider.discover(CONTEXT, new AbortController().signal);
    const b = await provider.discover(CONTEXT, new AbortController().signal);
    expect(a.items.map(i => i.providerLocalKey)).toEqual(b.items.map(i => i.providerLocalKey));
  });

  it('enforces bounded discovery (entry cap)', async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < MAX_COMMAND_ENTRIES + 50; i++) {
      big[`${HOME}/.claude/commands/cmd-${i}.md`] = 'x';
    }
    const { provider } = makeDeps(big);
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    expect(catalog.items.length).toBeLessThanOrEqual(MAX_COMMAND_ENTRIES);
  });

  it('respects abort', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.discover(CONTEXT, controller.signal)).rejects.toThrow(/aborted/);
  });

  it('assesses portable skills per skill: resourceful ones unsupported, plain ones emulated', async () => {
    const { provider } = makeDeps(SKILL_TREE);
    const plain: PortableSkillCandidate = {
      id: 'plain',
      name: 'plain',
      description: '',
      metadata: {},
      resourceManifest: [],
      contentDigest: 'd',
    };
    const withResources: PortableSkillCandidate = {
      ...plain,
      id: 'rich',
      resourceManifest: [{ relativePath: 'data.csv', size: 10, contentDigest: 'x' }],
    };
    const plainAssessment = await provider.assessPortableSkill!(
      plain,
      CONTEXT,
      new AbortController().signal
    );
    expect(plainAssessment).toMatchObject({
      supported: true,
      mode: 'emulated',
      executionMode: 'emulated',
      fidelity: 'best-effort',
      resourceAccess: 'none',
    });
    const richAssessment = await provider.assessPortableSkill!(
      withResources,
      CONTEXT,
      new AbortController().signal
    );
    expect(richAssessment).toMatchObject({ supported: false, mode: 'unsupported' });
  });
});

// ── startTurn (V2 adapter contract) ──────────────────────────────────────────

const runSpy = vi.fn(async function* (input: string) {
  yield { type: 'provider_turn_finished', isComplete: true } as never;
  void input;
});

vi.mock('../runner.js', () => ({
  runClaudeAgent: runSpy,
  loadClaudeAgentConfig: vi.fn(() => ({ mcpServers: {}, plugins: [] })),
}));

async function makeAdapter() {
  runSpy.mockClear();
  const { ClaudeAgentAdapter } = await import('../adapter.js');
  const adapter = new ClaudeAgentAdapter(async () => null);
  return { adapter, runSpy };
}

function turnContext(): RuntimeTurnContext {
  return {
    cwd: '/repo',
    services: {
      portableSkillResources: {
        read: async () => {
          throw new Error('unused');
        },
      },
    },
  } as unknown as RuntimeTurnContext;
}

describe('ClaudeAgentAdapter.startTurn', () => {
  it('passes message text through byte-for-byte', async () => {
    const { adapter, runSpy } = await makeAdapter();
    const input: RuntimeTurnInput = { type: 'message', text: 'plain text' };
    for await (const _ of adapter.startTurn(input, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('plain text');
  });

  it('native-text invocation preserves the exact /trigger args syntax', async () => {
    const { adapter, runSpy } = await makeAdapter();
    const descriptor = {
      id: 'inv1:review',
      kind: 'runtime.command' as const,
      runtimeType: 'claude',
      name: 'review',
      label: 'review',
      displayTrigger: '/review',
      origin: { owner: 'runtime' as const, scope: 'project' as const },
      execution: {
        mode: 'native-text' as const,
        fidelity: 'exact' as const,
        arguments: {
          accepted: ['raw' as const],
          preferred: 'raw' as const,
          transcript: { raw: 'verbatim' as const },
        },
      },
      availability: { available: true } as const,
    };
    const input: RuntimeTurnInput = {
      type: 'runtime-invocation',
      descriptor,
      nativeLocator: { type: 'claude-command', file: '/repo/.claude/commands/review.md' },
      arguments: { type: 'raw', value: '--deep focus auth' },
    };
    for await (const _ of adapter.startTurn(input, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('/review --deep focus auth');
  });

  it('compiles portable skills into an ordinary prompt, body first (emulated)', async () => {
    const { adapter, runSpy } = await makeAdapter();
    const input: RuntimeTurnInput = {
      type: 'portable-skill',
      skill: {
        id: 'release-notes',
        name: 'release-notes',
        description: '',
        body: 'SKILL BODY',
        metadata: {},
        contentDigest: 'd',
      },
      assessment: {
        supported: true,
        mode: 'emulated',
        executionMode: 'emulated',
        fidelity: 'best-effort',
        resourceAccess: 'none',
      },
      arguments: { type: 'raw', value: 'ZOOM-1' },
    };
    for await (const _ of adapter.startTurn(input, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('SKILL BODY\n\nZOOM-1');
  });
});
