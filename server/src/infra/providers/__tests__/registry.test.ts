import { describe, it, expect } from 'vitest';
import { providerRegistry, ProviderRegistry } from '../registry.js';
import type { ProviderAdapter } from '../types.js';

/** Minimal fake adapter used for testing register/get */
function createFakeAdapter(type: string): ProviderAdapter {
  return {
    type,
    async *run() {
      // no-op generator
    },
  };
}

function fakeAdapter(type: string): ProviderAdapter {
  return {
    type,
    async *run() {
      /* no-op */
    },
  };
}

describe('ProviderRegistry', () => {
  describe('built-in adapters', () => {
    it('has a zclaudia adapter registered by default', () => {
      const adapter = providerRegistry.get('zclaudia');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('zclaudia');
    });

    it('has a claude runtime adapter registered by default', () => {
      const adapter = providerRegistry.get('claude');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('claude');
    });
  });

  describe('register', () => {
    it('adds a new adapter that can be retrieved', () => {
      const fake = createFakeAdapter('custom-provider');
      providerRegistry.register(fake);

      const retrieved = providerRegistry.get('custom-provider');
      expect(retrieved).toBeDefined();
      expect(retrieved).toBe(fake);
      expect(retrieved!.type).toBe('custom-provider');
    });

    it('overwrites an existing adapter with the same type', () => {
      const fake1 = createFakeAdapter('overwrite-test');
      const fake2 = createFakeAdapter('overwrite-test');

      providerRegistry.register(fake1);
      providerRegistry.register(fake2);

      const retrieved = providerRegistry.get('overwrite-test');
      expect(retrieved).toBe(fake2);
    });
  });

  describe('get', () => {
    it('returns the registered adapter for a known type', () => {
      const adapter = providerRegistry.get('zclaudia');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('zclaudia');
    });

    it('returns undefined for an unknown type', () => {
      const adapter = providerRegistry.get('nonexistent-provider-xyz');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getOrDefault', () => {
    it('returns the requested adapter when it exists', () => {
      const adapter = providerRegistry.getOrDefault('zclaudia');
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe('zclaudia');
    });

    it('falls back to the zclaudia adapter for an unknown type', () => {
      const adapter = providerRegistry.getOrDefault('unknown-type-abc');
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe('zclaudia');
    });

    it('always returns a defined adapter (never undefined)', () => {
      const adapter = providerRegistry.getOrDefault('does-not-exist');
      expect(adapter).toBeDefined();
    });
  });

  describe('provider definition', () => {
    it('returns zclaudia policy separately from the PCP capability manifest', () => {
      const policy = providerRegistry.getPolicy('zclaudia');
      const definition = providerRegistry.getDefinition('zclaudia');

      expect(policy?.modeSwitchSessionPolicy).toBe('preserve');
      expect(definition?.capabilityManifest.providerType).toBe('zclaudia');
      expect(definition?.policy).toBe(policy);
    });

    it('only registers migrated coding agent adapters by default', () => {
      expect(providerRegistry.get('claude')).toBeDefined();
      expect(providerRegistry.get('opencode')).toBeUndefined();
      expect(providerRegistry.get('codex')).toBeUndefined();
      expect(providerRegistry.get('cursor')).toBeUndefined();
      expect(providerRegistry.get('kimi')).toBeUndefined();
    });

    it('declares Claude advanced capabilities as unsupported until implemented', () => {
      const definition = providerRegistry.getDefinition('claude');
      const capabilities = Object.fromEntries(
        definition!.capabilityManifest.capabilities.map(capability => [
          capability.id,
          capability.supported,
        ])
      );

      expect(capabilities['input.image']).toBe(false);
      expect(capabilities['input.text_file']).toBe(false);
      expect(capabilities['input.binary_file']).toBe(false);
      expect(capabilities['session.background_task']).toBe(false);
    });
  });
});

describe('ProviderRegistry plugin ownership', () => {
  it('registers and lists plugin adapters, then removes them by plugin', () => {
    const reg = new ProviderRegistry();
    expect(reg.hasType('zclaudia')).toBe(true);
    expect(reg.hasType('claude-x')).toBe(false);

    reg.registerPluginAdapter('com.test.x', fakeAdapter('claude-x'));
    expect(reg.hasType('claude-x')).toBe(true);
    expect(reg.listTypes()).toContain('claude-x');

    reg.removePluginAdapters('com.test.x');
    expect(reg.hasType('claude-x')).toBe(false);
  });

  it('does not remove built-in adapters when removing a plugin', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.x', fakeAdapter('claude-x'));
    reg.removePluginAdapters('com.test.x');
    expect(reg.hasType('zclaudia')).toBe(true);
  });

  it('throws when a plugin adapter type collides with a built-in', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.registerPluginAdapter('com.test.x', fakeAdapter('zclaudia'))).toThrow(
      /already registered/
    );
  });

  it('throws when a second plugin claims a type owned by another plugin', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.a', fakeAdapter('shared-type'));
    expect(() => reg.registerPluginAdapter('com.test.b', fakeAdapter('shared-type'))).toThrow(
      /already registered/
    );
  });

  it('allows the same plugin to re-register its own type', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.a', fakeAdapter('own-type'));
    expect(() => reg.registerPluginAdapter('com.test.a', fakeAdapter('own-type'))).not.toThrow();
  });
});
