import { PI_AGENT_RUNTIME, normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

// NOTE: `manifest.runtime` is typed as `ProviderRuntimeKind` in
// shared/src/core/pcp.ts, which only allows 'cli' | 'sdk' | 'http' | 'bridge'
// ('native' is not a member). The built-in Pi adapter
// (server/src/infra/providers/pi-agent/adapter.ts) uses 'sdk' for its PCP
// manifest, so we mirror that here.
const PI_DESCRIPTOR: AgentRuntimeDescriptor = {
  type: PI_AGENT_RUNTIME,
  label: 'Pi',
  model: { kind: 'llm-profile', multimodalFallback: true, thinkingLevel: 'selectable' },
  hasCliPath: false,
  capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
  manifest: {
    id: PI_AGENT_RUNTIME,
    name: 'Pi',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: PI_AGENT_RUNTIME,
    runtime: 'sdk',
    capabilities: [],
  },
};

export class RuntimeDescriptorRegistry {
  private descriptors = new Map<string, AgentRuntimeDescriptor>();
  private byPlugin = new Map<string, Set<string>>();

  constructor() {
    this.descriptors.set(PI_DESCRIPTOR.type, PI_DESCRIPTOR);
  }

  registerForPlugin(pluginId: string, descriptor: AgentRuntimeDescriptor): void {
    const ownedByPlugin = this.byPlugin.get(pluginId)?.has(descriptor.type) ?? false;
    if (this.descriptors.has(normalizeAgentRuntimeType(descriptor.type)) && !ownedByPlugin) {
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
    return this.descriptors.get(normalizeAgentRuntimeType(type));
  }

  list(): AgentRuntimeDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  hasType(type: string): boolean {
    return this.descriptors.has(normalizeAgentRuntimeType(type));
  }
}

export const runtimeDescriptorRegistry = new RuntimeDescriptorRegistry();
