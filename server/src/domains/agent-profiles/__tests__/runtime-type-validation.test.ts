import { describe, it, expect } from 'vitest';
import { isValidRuntimeType } from '../runtime-type-guard.js';
import { providerRegistry } from '../../../infra/providers/registry.js';

describe('isValidRuntimeType', () => {
  it('accepts the built-in zclaudia', () => {
    expect(isValidRuntimeType('zclaudia')).toBe(true);
  });
  it('rejects an unknown/unregistered runtime', () => {
    expect(isValidRuntimeType('totally-unknown')).toBe(false);
  });
  it('accepts a runtime once its adapter is registered, rejects after removal', () => {
    providerRegistry.registerPluginAdapter('com.test.rt', {
      type: 'test-rt',
      async *run() {},
    });
    expect(isValidRuntimeType('test-rt')).toBe(true);
    providerRegistry.removePluginAdapters('com.test.rt');
    expect(isValidRuntimeType('test-rt')).toBe(false);
  });
});
