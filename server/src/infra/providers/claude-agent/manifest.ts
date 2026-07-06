import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';

export const CLAUDE_AGENT_MANIFEST: PCPProviderManifest = {
  id: 'claude',
  name: 'Claude',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'claude',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.form', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.approval', supported: false, degradation: 'fallback_to_notice' },
    { id: 'interaction.todo', supported: false, degradation: 'fallback_to_text' },
    { id: 'input.image', supported: false, degradation: 'fallback_to_notice' },
    { id: 'input.text_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'input.binary_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.steer', supported: false, degradation: 'fallback_to_text' },
    { id: 'session.background_task', supported: false, degradation: 'fallback_to_text' },
  ],
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'acceptEdits',
    autonomous: 'bypassPermissions',
    plan_only: 'plan',
  },
};

export const CLAUDE_AGENT_POLICY: ProviderPolicy = {
  nativeInteractionTools: ['enter_plan_mode', 'exit_plan_mode'],
  modeSwitchSessionPolicy: 'preserve',
  sessionCwdPolicy: 'requested',
  escalateAlwaysTools: ['ExitPlanMode'],
};
