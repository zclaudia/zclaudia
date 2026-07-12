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

export class RuntimeDescriptorRegistry {
  private descriptors = new Map<string, AgentRuntimeDescriptor>();
  private byPlugin = new Map<string, Set<string>>();

  constructor() {
    this.descriptors.set(ZCLAUDIA_DESCRIPTOR.type, ZCLAUDIA_DESCRIPTOR);
  }

  registerForPlugin(pluginId: string, descriptor: AgentRuntimeDescriptor): void {
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
