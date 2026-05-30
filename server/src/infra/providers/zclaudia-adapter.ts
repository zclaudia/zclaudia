import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ClaudeMessage, ProviderAdapter, RunOptions } from './types.js';

const manifest: PCPProviderManifest = {
  id: 'zclaudia',
  name: 'ZClaudia Agent',
  version: '0.1.0',
  apiVersion: 'pcp/v1',
  providerType: 'zclaudia',
  runtime: 'sdk',
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'default',
    autonomous: 'default',
    plan_only: 'plan',
  },
  capabilities: [
    { id: 'chat.stream', supported: true, mode: 'emulated', reliability: 'strict' },
    { id: 'tool.call', supported: false, degradation: 'fallback_to_text' },
    { id: 'tool.inject', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.form', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.approval', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.todo', supported: false, degradation: 'fallback_to_text' },
    { id: 'input.image', supported: false, degradation: 'fallback_to_notice' },
    { id: 'input.text_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'input.binary_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'permission.mode', supported: true, mode: 'emulated', reliability: 'display_only' },
    { id: 'session.abort', supported: true, mode: 'emulated', reliability: 'strict' },
    { id: 'session.background_task', supported: false, degradation: 'fallback_to_text' },
  ],
};

const policy: ProviderPolicy = {
  modeSwitchSessionPolicy: 'preserve',
  sessionCwdPolicy: 'requested',
  emptyResultFallback: 'ZClaudia agent completed without additional output.',
};

function buildStubResponse(input: string, options: RunOptions): string {
  const mode = options.mode || 'default';
  const model = options.model || 'stub';
  const prompt = input.trim() || '(empty prompt)';
  return [
    'ZClaudia agent runtime stub is active.',
    '',
    `Mode: ${mode}`,
    `Model: ${model}`,
    `Prompt: ${prompt}`,
    '',
    'pi-agent is not integrated yet; this response confirms the zclaudia runtime path is wired.',
  ].join('\n');
}

export class ZClaudiaAdapter implements ProviderAdapter {
  readonly type = 'zclaudia';
  readonly manifest = manifest;
  readonly policy = policy;

  async *run(input: string, options: RunOptions): AsyncGenerator<ClaudeMessage, void, void> {
    const sessionId = options.sessionId || `zclaudia-stub-${Date.now()}`;
    yield {
      type: 'init',
      sessionId,
      systemInfo: {
        model: options.model || 'zclaudia-stub',
        cwd: options.cwd,
        permissionMode: options.mode || 'default',
        tools: [],
        agents: ['zclaudia-stub'],
      },
    };

    yield {
      type: 'assistant',
      content: buildStubResponse(input, options),
    };

    yield {
      type: 'result',
      usage: {
        inputTokens: input.length,
        outputTokens: 0,
      },
      isComplete: true,
    };
  }
}
