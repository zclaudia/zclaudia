import { providerRegistry } from '../../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';

/**
 * A runtime type is valid if a live adapter is registered for it (built-in or
 * plugin) OR a descriptor is registered for it. The descriptor check matters
 * because during plugin activation the `agentRuntimes` descriptor is
 * registered in `registerContributions` before the plugin's `activate()`
 * registers the live adapter — a bundled `agentProfiles` contribution that
 * binds to that runtime must still validate at that point.
 */
export function isValidRuntimeType(type: string): boolean {
  return providerRegistry.hasType(type) || runtimeDescriptorRegistry.hasType(type);
}
