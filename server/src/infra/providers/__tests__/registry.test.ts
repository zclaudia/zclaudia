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

    it('does not register claude as a built-in (it is a plugin runtime)', () => {
      const reg = new ProviderRegistry();
      expect(reg.get('claude')).toBeUndefined();
    });

    it('accepts claude when registered via a plugin adapter', () => {
      const reg = new ProviderRegistry();
      reg.registerPluginAdapter('com.zclaudia.claude', fakeAdapter('claude'));
      expect(reg.hasType('claude')).toBe(true);
      expect(reg.get('claude')?.type).toBe('claude');
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

    it('only registers the built-in zclaudia adapter by default', () => {
      expect(providerRegistry.get('zclaudia')).toBeDefined();
      expect(providerRegistry.get('claude')).toBeUndefined();
      expect(providerRegistry.get('opencode')).toBeUndefined();
      expect(providerRegistry.get('codex')).toBeUndefined();
      expect(providerRegistry.get('cursor')).toBeUndefined();
      expect(providerRegistry.get('kimi')).toBeUndefined();
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

  it('removePluginAdapter removes only the named type, leaving other types of the same plugin', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.multi', fakeAdapter('a'));
    reg.registerPluginAdapter('com.test.multi', fakeAdapter('b'));
    expect(reg.hasType('a')).toBe(true);
    expect(reg.hasType('b')).toBe(true);

    reg.removePluginAdapter('com.test.multi', 'a');
    expect(reg.hasType('a')).toBe(false);
    expect(reg.hasType('b')).toBe(true);
  });

  it('removePluginAdapter is a no-op for a type not owned by the plugin', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.multi', fakeAdapter('a'));

    // Type owned by a different plugin
    reg.registerPluginAdapter('com.test.other', fakeAdapter('b'));
    reg.removePluginAdapter('com.test.multi', 'b');
    expect(reg.hasType('b')).toBe(true);

    // Type not registered at all
    reg.removePluginAdapter('com.test.multi', 'never');
    expect(reg.hasType('a')).toBe(true);

    // Unknown plugin entirely
    expect(() => reg.removePluginAdapter('com.test.nobody', 'a')).not.toThrow();
    expect(reg.hasType('a')).toBe(true);
  });

  it('removePluginAdapter cleans up the ownership entry when the last type is removed', () => {
    const reg = new ProviderRegistry();
    reg.registerPluginAdapter('com.test.multi', fakeAdapter('a'));
    reg.removePluginAdapter('com.test.multi', 'a');
    expect(reg.hasType('a')).toBe(false);

    // Ownership entry is gone, so a later collision with a built-in still throws
    // (i.e. the plugin is no longer treated as the owner of anything).
    expect(() => reg.registerPluginAdapter('com.test.multi', fakeAdapter('zclaudia'))).toThrow(
      /already registered/
    );
    // And it can freshly claim a new non-colliding type again.
    expect(() => reg.registerPluginAdapter('com.test.multi', fakeAdapter('a'))).not.toThrow();
    expect(reg.hasType('a')).toBe(true);
  });
});
