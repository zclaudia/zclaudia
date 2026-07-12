import { providerRegistry } from '../../infra/providers/registry.js';

/** A runtime type is valid if an adapter is registered for it (built-in or plugin). */
export function isValidRuntimeType(type: string): boolean {
  return providerRegistry.hasType(type);
}
