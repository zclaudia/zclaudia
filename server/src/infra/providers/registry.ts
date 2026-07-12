import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ProviderDefinition } from './definitions.js';
import type { ProviderAdapter } from './types.js';
import { PiAgentProviderAdapter } from './pi-agent/adapter.js';
import { ClaudeAgentAdapter } from './external-agents/claude/adapter.js';

/** Port interface — conversation domain depends on this, not on the concrete registry. */
export interface ProviderRegistryPort {
  get(type: string): ProviderAdapter | undefined;
  getOrDefault(type: string): ProviderAdapter;
  getPolicy(type: string): ProviderPolicy | undefined;
  getDefinition(type: string): ProviderDefinition | undefined;
  hasType(type: string): boolean;
  listTypes(): string[];
}

export class ProviderRegistry implements ProviderRegistryPort {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultType = 'zclaudia';
  private pluginAdapterTypes = new Map<string, Set<string>>(); // pluginId -> types

  constructor() {
    this.register(new PiAgentProviderAdapter());
    this.register(new ClaudeAgentAdapter());
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  registerPluginAdapter(pluginId: string, adapter: ProviderAdapter): void {
    this.register(adapter);
    const set = this.pluginAdapterTypes.get(pluginId) ?? new Set<string>();
    set.add(adapter.type);
    this.pluginAdapterTypes.set(pluginId, set);
  }

  removePluginAdapters(pluginId: string): void {
    const set = this.pluginAdapterTypes.get(pluginId);
    if (!set) return;
    for (const type of set) this.adapters.delete(type);
    this.pluginAdapterTypes.delete(pluginId);
  }

  hasType(type: string): boolean {
    return this.adapters.has(type);
  }

  listTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  get(type: string): ProviderAdapter | undefined {
    return this.adapters.get(type);
  }

  getOrDefault(type: string): ProviderAdapter {
    return this.adapters.get(type) || this.adapters.get(this.defaultType)!;
  }

  /** Get PCP manifest for a provider */
  getManifest(type: string): PCPProviderManifest | undefined {
    return this.adapters.get(type)?.manifest;
  }

  /** Get ZClaudia runtime policy for a provider */
  getPolicy(type: string): ProviderPolicy | undefined {
    return this.adapters.get(type)?.policy;
  }

  /** Get the composed provider definition used by the runtime. */
  getDefinition(type: string): ProviderDefinition | undefined {
    const adapter = this.adapters.get(type);
    if (!adapter?.manifest) return undefined;
    return {
      adapter,
      capabilityManifest: adapter.manifest,
      policy: adapter.policy ?? {},
      normalizer: adapter.normalizer,
    };
  }

  /** Get all registered PCP manifests */
  getAllManifests(): PCPProviderManifest[] {
    return Array.from(this.adapters.values())
      .map(a => a.manifest)
      .filter((m): m is PCPProviderManifest => !!m);
  }
}

export const providerRegistry = new ProviderRegistry();
