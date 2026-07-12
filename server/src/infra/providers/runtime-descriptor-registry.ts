import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

// NOTE: `manifest.runtime` is typed as `ProviderRuntimeKind` in
// shared/src/core/pcp.ts, which only allows 'cli' | 'sdk' | 'http' | 'bridge'
// ('native' is not a member). The built-in zclaudia adapter
// (server/src/infra/providers/pi-agent/adapter.ts) uses 'sdk' for its PCP
// manifest, so we mirror that here.
const ZCLAUDIA_DESCRIPTOR: AgentRuntimeDescriptor = {
  type: 'zclaudia',
  label: 'ZClaudia',
  model: { kind: 'llm-profile', multimodalFallback: true, thinkingLevel: true },
  capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
  manifest: {
    id: 'zclaudia',
    name: 'ZClaudia',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'zclaudia',
    runtime: 'sdk',
    capabilities: [],
  },
};

// TRANSITIONAL (removed in Phase 4 when claude becomes a plugin):
// Seeded here as a built-in so the endpoint returns it and the desktop keeps
// working until the `com.zclaudia.claude` plugin registers it itself. The
// manifest/policy literals below are copied from
// server/src/infra/providers/external-agents/claude/manifest.ts
// (CLAUDE_AGENT_MANIFEST / CLAUDE_AGENT_POLICY) rather than imported, so this
// registry stays self-contained.
const CLAUDE_DESCRIPTOR: AgentRuntimeDescriptor = {
  type: 'claude',
  label: 'Claude',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: true },
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  authNote:
    'Claude uses the Claude Agent SDK runtime. MCP servers and skills come from ~/.claude; built-in tool sets are not injected.',
  manifest: {
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
      { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
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
  },
  policy: {
    nativeInteractionTools: ['enter_plan_mode', 'exit_plan_mode'],
    modeSwitchSessionPolicy: 'preserve',
    sessionCwdPolicy: 'requested',
    escalateAlwaysTools: ['ExitPlanMode'],
  },
};

export class RuntimeDescriptorRegistry {
  private descriptors = new Map<string, AgentRuntimeDescriptor>();
  private byPlugin = new Map<string, Set<string>>();

  constructor() {
    this.descriptors.set(ZCLAUDIA_DESCRIPTOR.type, ZCLAUDIA_DESCRIPTOR);
    // TRANSITIONAL (removed in Phase 4 when claude becomes a plugin): seeded
    // built-in-style like zclaudia — never registered under a pluginId, so
    // removeForPlugin() never touches it.
    this.descriptors.set('claude', CLAUDE_DESCRIPTOR);
  }

  registerForPlugin(pluginId: string, descriptor: AgentRuntimeDescriptor): void {
    const ownedByPlugin = this.byPlugin.get(pluginId)?.has(descriptor.type) ?? false;
    if (this.descriptors.has(descriptor.type) && !ownedByPlugin) {
      throw new Error(
        `Runtime type "${descriptor.type}" is already registered (built-in or another plugin); plugin ${pluginId} cannot claim it`
      );
    }
    this.descriptors.set(descriptor.type, descriptor);
    const set = this.byPlugin.get(pluginId) ?? new Set<string>();
    set.add(descriptor.type);
    this.byPlugin.set(pluginId, set);
  }

  removeForPlugin(pluginId: string): void {
    const set = this.byPlugin.get(pluginId);
    if (!set) return;
    for (const type of set) this.descriptors.delete(type);
    this.byPlugin.delete(pluginId);
  }

  get(type: string): AgentRuntimeDescriptor | undefined {
    return this.descriptors.get(type);
  }

  list(): AgentRuntimeDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  hasType(type: string): boolean {
    return this.descriptors.has(type);
  }
}

export const runtimeDescriptorRegistry = new RuntimeDescriptorRegistry();
