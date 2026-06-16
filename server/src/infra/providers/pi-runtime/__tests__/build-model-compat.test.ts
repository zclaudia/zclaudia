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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { model } = buildModel(proxyProfile(), 'deepseek-v4-flash');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((model as any).compat?.thinkingFormat).toBe('deepseek');
    expect(devRole(model)).toBe(false);
  });

  it('respects an explicit profile compat override (true wins)', () => {
    const { model } = buildModel(
      proxyProfile({ compat: { supportsDeveloperRole: true } }),
      'deepseek-v4-flash',
    );
    expect(devRole(model)).toBe(true);
  });

  it('does NOT force developer role off for canonical api.openai.com', () => {
    const { model } = buildModel(
      proxyProfile({ baseUrl: 'https://api.openai.com/v1' }),
      'some-unregistered-model-xyz',
    );
    expect(devRole(model)).not.toBe(false);
  });
});
