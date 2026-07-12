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
  private builtinsRegistered = false;

  /**
   * Built-in adapters are registered lazily (on first real use) rather than in the
   * constructor. Several domains transitively import this module as part of a
   * dependency cycle that loops back through `pi-agent/adapter.ts` (the module that
   * defines `PiAgentProviderAdapter`); constructing that adapter eagerly at module
   * top-level can run while `PiAgentProviderAdapter`'s own module is still mid-evaluation,
   * throwing "PiAgentProviderAdapter is not a constructor". Deferring registration until
   * a method is actually called sidesteps that import-order hazard.
   */
  private ensureBuiltinsRegistered(): void {
    if (this.builtinsRegistered) return;
    this.builtinsRegistered = true;
    this.register(new PiAgentProviderAdapter());
    this.register(new ClaudeAgentAdapter());
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  registerPluginAdapter(pluginId: string, adapter: ProviderAdapter): void {
    this.ensureBuiltinsRegistered();
    const ownedByPlugin = this.pluginAdapterTypes.get(pluginId)?.has(adapter.type) ?? false;
    if (this.adapters.has(adapter.type) && !ownedByPlugin) {
      throw new Error(
        `Runtime type "${adapter.type}" is already registered (built-in or another plugin); plugin ${pluginId} cannot claim it`
      );
    }
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

  /** Remove one plugin-owned runtime type. No-op if not owned by this plugin. */
  removePluginAdapter(pluginId: string, type: string): void {
    const set = this.pluginAdapterTypes.get(pluginId);
    if (!set || !set.has(type)) return;
    this.adapters.delete(type);
    set.delete(type);
    if (set.size === 0) this.pluginAdapterTypes.delete(pluginId);
  }

  hasType(type: string): boolean {
    this.ensureBuiltinsRegistered();
    return this.adapters.has(type);
  }

  listTypes(): string[] {
    this.ensureBuiltinsRegistered();
    return Array.from(this.adapters.keys());
  }

  get(type: string): ProviderAdapter | undefined {
    this.ensureBuiltinsRegistered();
    return this.adapters.get(type);
  }

  getOrDefault(type: string): ProviderAdapter {
    this.ensureBuiltinsRegistered();
    return this.adapters.get(type) || this.adapters.get(this.defaultType)!;
  }

  /** Get PCP manifest for a provider */
  getManifest(type: string): PCPProviderManifest | undefined {
    this.ensureBuiltinsRegistered();
    return this.adapters.get(type)?.manifest;
  }

  /** Get ZClaudia runtime policy for a provider */
  getPolicy(type: string): ProviderPolicy | undefined {
    this.ensureBuiltinsRegistered();
    return this.adapters.get(type)?.policy;
  }

  /** Get the composed provider definition used by the runtime. */
  getDefinition(type: string): ProviderDefinition | undefined {
    this.ensureBuiltinsRegistered();
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
    this.ensureBuiltinsRegistered();
    return Array.from(this.adapters.values())
      .map(a => a.manifest)
      .filter((m): m is PCPProviderManifest => !!m);
  }
}

export const providerRegistry = new ProviderRegistry();
