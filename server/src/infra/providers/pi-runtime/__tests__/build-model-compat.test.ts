import { describe, it, expect } from 'vitest';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { buildModel } from '../build-model.js';

function proxyProfile(over: Partial<LlmProfileConfig> = {}): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'proxy',
    providerType: 'openai',
    baseUrl: 'http://192.168.2.150:3022/v1',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const devRole = (model: any): boolean | undefined => model.compat?.supportsDeveloperRole;

describe('buildModel — openai-compat developer role', () => {
  it('pins supportsDeveloperRole=false for a third-party proxy on a registry-hit model', () => {
    // deepseek-v4-flash resolves via the cross-provider registry sweep; its
    // registry compat does NOT set supportsDeveloperRole, so without this guard
    // pi-ai would emit the `developer` role and the proxy rejects it.
    const { model } = buildModel(proxyProfile(), 'deepseek-v4-flash');
    expect(devRole(model)).toBe(false);
  });

  it('pins supportsDeveloperRole=false for an unregistered model (openai-compat literal path)', () => {
    const { model } = buildModel(proxyProfile(), 'some-unregistered-model-xyz');
    expect(devRole(model)).toBe(false);
  });

  it('preserves other registry compat fields when pinning developer role', () => {
    // deepseek registry entry carries thinkingFormat:'deepseek' — must survive.

    const { model } = buildModel(proxyProfile(), 'deepseek-v4-flash');

    expect((model as any).compat?.thinkingFormat).toBe('deepseek');
    expect(devRole(model)).toBe(false);
  });

  it('respects an explicit profile compat override (true wins)', () => {
    const { model } = buildModel(
      proxyProfile({ compat: { supportsDeveloperRole: true } }),
      'deepseek-v4-flash'
    );
    expect(devRole(model)).toBe(true);
  });

  it('does NOT force developer role off for canonical api.openai.com', () => {
    const { model } = buildModel(
      proxyProfile({ baseUrl: 'https://api.openai.com/v1' }),
      'some-unregistered-model-xyz'
    );
    expect(devRole(model)).not.toBe(false);
  });
});

describe('buildModel — model dialect', () => {
  it('explicit dialect overrides provider on the openai-completions wire and is stamped', () => {
    const { model } = buildModel(proxyProfile(), 'my-kimi-alias', {
      modelId: 'my-kimi-alias',
      dialect: 'moonshotai',
    });
    expect(model.provider).toBe('moonshotai');
    expect((model as any).dialect).toBe('moonshotai');
  });

  it('auto-inherits the registry provider from a cross-provider hit', () => {
    const { model } = buildModel(proxyProfile(), 'deepseek-v4-flash');
    expect(model.provider).toBe('deepseek');
    expect((model as any).dialect).toBe('deepseek');
  });

  it('dialect "openai" suppresses auto-inherit', () => {
    const { model } = buildModel(proxyProfile(), 'deepseek-v4-flash', {
      modelId: 'deepseek-v4-flash',
      dialect: 'openai',
    });
    expect(model.provider).toBe('openai');
    expect((model as any).dialect).toBe('openai');
  });

  it('does not inherit registry providers outside the dialect allowlist', () => {
    // claude ids hit the registry under providers like 'anthropic' — not a
    // dialect, so provider must stay the profile providerType.
    const { model } = buildModel(proxyProfile(), 'claude-opus-4-7');
    expect(model.provider).toBe('openai');
    expect((model as any).dialect).toBeUndefined();
  });

  it('leaves provider untouched on the anthropic wire but still stamps dialect', () => {
    // Must use a REGISTERED claude id: an unregistered id on an anthropic
    // profile falls to the openai-compat literal (api 'openai-completions'),
    // where the provider override intentionally applies. A registry hit on
    // providerType 'anthropic' gets api 'anthropic-messages' — the wire this
    // test pins.
    const { model } = buildModel(
      proxyProfile({ providerType: 'anthropic', baseUrl: undefined }),
      'claude-opus-4-7',
      { modelId: 'claude-opus-4-7', dialect: 'moonshotai' }
    );
    expect(model.api).toBe('anthropic-messages');
    expect(model.provider).toBe('anthropic');
    expect((model as any).dialect).toBe('moonshotai');
  });

  it('unregistered model without dialect keeps current behavior', () => {
    const { model } = buildModel(proxyProfile(), 'some-unregistered-model-xyz');
    expect(model.provider).toBe('openai');
    expect((model as any).dialect).toBeUndefined();
  });
});
