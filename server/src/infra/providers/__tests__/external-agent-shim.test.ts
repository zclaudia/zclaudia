import { describe, it, expect, vi } from 'vitest';
import { toExternalAgentRunContext, wrapExternalAgentAdapter } from '../external-agent-shim.js';
import type { RunOptions } from '../types.js';
import type { AgentRuntimeDescriptor, ExternalAgentAdapter } from '@zclaudia/shared/providers';

const descriptor: AgentRuntimeDescriptor = {
  type: 'claude',
  label: 'Claude',
  model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: true,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'claude',
    name: 'Claude',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'claude',
    runtime: 'cli',
    capabilities: [],
  },
  policy: { escalateAlwaysTools: ['ExitPlanMode'] },
};

const baseOptions = (): RunOptions => ({
  cwd: '/repo',
  sessionId: 's1',
  serverPort: 3100,
  claudiaSessionId: 'cs1',
  thinkingLevel: 'medium',
  agentProfile: {
    id: 'p',
    name: 'x',
    llmProfileId: '',
    model: 'claude-sonnet-4-6',
    cliPath: '/usr/bin/claude',
    systemPrompt: '',
    enabledTools: [],
    createdAt: 0,
    updatedAt: 0,
  },
  systemPrompt: 'SP',
  mode: 'plan_only',
});

describe('toExternalAgentRunContext', () => {
  it('maps only the external-agent-relevant fields', () => {
    const ctx = toExternalAgentRunContext(baseOptions());
    expect(ctx).toMatchObject({
      cwd: '/repo',
      sessionId: 's1',
      serverPort: 3100,
      claudiaSessionId: 'cs1',
      thinkingLevel: 'medium',
      model: 'claude-sonnet-4-6',
      cliPath: '/usr/bin/claude',
      systemPrompt: 'SP',
      mode: 'plan_only',
    });
    // does NOT leak pi-runtime internals
    expect('externalToolState' in ctx).toBe(false);
    expect('toolExecutionObserver' in ctx).toBe(false);
    expect('db' in ctx).toBe(false);
  });
});

describe('wrapExternalAgentAdapter', () => {
  it.each(['complete', 'error', 'return'] as const)(
    'releases the runtime lifecycle on %s',
    async ending => {
      const release = vi.fn();
      const retain = vi.fn(() => release);
      const ext: ExternalAgentAdapter = {
        type: 'claude',
        async *run() {
          yield { type: 'assistant_delta', content: 'started' };
          if (ending === 'error') throw new Error('provider failed');
        },
      };
      const adapter = wrapExternalAgentAdapter(ext, descriptor, retain);
      const options = { ...baseOptions(), claudiaSessionId: 'host-session' };
      const stream = adapter.run('hi', options, async () => ({ behavior: 'allow' }));
      await stream.next();
      expect(retain).toHaveBeenCalledWith(
        expect.objectContaining({ claudiaSessionId: 'host-session' })
      );
      expect(release).not.toHaveBeenCalled();
      if (ending === 'return') await stream.return();
      else if (ending === 'error') await expect(stream.next()).rejects.toThrow('provider failed');
      else expect((await stream.next()).done).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
    }
  );

  it('exposes descriptor manifest/policy and forwards run', async () => {
    const ext: ExternalAgentAdapter = {
      type: 'claude',
      async *run(input, ctx) {
        yield { type: 'assistant_delta', content: `${input}@${ctx.cwd}` };
      },
    };
    const adapter = wrapExternalAgentAdapter(ext, descriptor);
    expect(adapter.type).toBe('claude');
    expect(adapter.manifest?.providerType).toBe('claude');
    expect(adapter.policy?.escalateAlwaysTools).toEqual(['ExitPlanMode']);

    const events: string[] = [];
    for await (const e of adapter.run('hi', baseOptions(), async () => ({ behavior: 'allow' }))) {
      if (e.content) events.push(e.content);
    }
    expect(events).toEqual(['hi@/repo']);
  });

  it('throws when the adapter type does not match the descriptor type', () => {
    const ext: ExternalAgentAdapter = {
      type: 'other',
      async *run() {
        /* no-op */
      },
    };
    expect(() => wrapExternalAgentAdapter(ext, descriptor)).toThrow(/does not match descriptor/);
  });
});
