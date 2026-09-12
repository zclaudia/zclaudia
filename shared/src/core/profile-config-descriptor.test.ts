import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_MODE,
  defaultEngineModeFor,
  projectEngineMode,
  resolveProfileConfigDescriptor,
  type EngineModeSourceDescriptor,
} from './profile-config-descriptor.js';
import type { EngineModeDescriptor } from './profile-config-descriptor.js';

const cliMode: EngineModeDescriptor = {
  id: 'cli',
  label: 'CLI',
  connection: { kind: 'external', modelSelection: 'optional' },
  executable: 'external-cli',
  modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
  capabilities: { tools: 'native-readonly', skills: 'external' },
};

const sdkMode: EngineModeDescriptor = {
  id: 'sdk',
  label: 'SDK + LLM Profile',
  connection: { kind: 'llm-profile', acceptedModelProtocols: ['anthropic-messages'] },
  executable: 'bundled-sdk',
  modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
  capabilities: { tools: 'native-readonly', skills: 'external' },
};

const dualModeDescriptor: EngineModeSourceDescriptor = {
  label: 'Claude',
  model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: true,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  defaultEngineMode: 'cli',
  engineModes: [cliMode, sdkMode],
};

describe('resolveProfileConfigDescriptor', () => {
  it('projects cli mode to model.kind native + external providers + cli path', () => {
    const resolved = resolveProfileConfigDescriptor(dualModeDescriptor, 'claude', 'cli');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.descriptor.model.kind).toBe('native');
    expect(resolved.descriptor.capabilities.providers).toBe('external');
    expect(resolved.descriptor.hasCliPath).toBe(true);
  });

  it('projects sdk mode to model.kind llm-profile + profile providers + no cli path', () => {
    const resolved = resolveProfileConfigDescriptor(dualModeDescriptor, 'claude', 'sdk');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.descriptor.model.kind).toBe('llm-profile');
    expect(resolved.descriptor.capabilities.providers).toBe('profile');
    expect(resolved.descriptor.hasCliPath).toBe(false);
  });

  it('defaults to the declared default engine mode', () => {
    const resolved = resolveProfileConfigDescriptor(dualModeDescriptor, 'claude', undefined);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.engineMode).toBe('cli');
  });

  it('rejects unknown modes instead of falling back', () => {
    const resolved = resolveProfileConfigDescriptor(dualModeDescriptor, 'claude', 'serverless');
    expect(resolved).toMatchObject({ ok: false, code: 'ENGINE_MODE_UNSUPPORTED' });
  });

  it('keeps legacy top-level fields canonical when no engineModes are declared', () => {
    const legacy: EngineModeSourceDescriptor = {
      label: 'Cursor',
      model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'off' },
      hasCliPath: true,
      capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
    };
    const resolved = resolveProfileConfigDescriptor(legacy, 'cursor');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.descriptor.model.kind).toBe('none');
    expect(resolved.descriptor.hasCliPath).toBe(true);
  });

  it('rejects a mode request against a legacy descriptor', () => {
    const legacy: EngineModeSourceDescriptor = {
      label: 'Cursor',
      model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'off' },
      hasCliPath: true,
      capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
    };
    expect(resolveProfileConfigDescriptor(legacy, 'cursor', 'sdk')).toMatchObject({
      ok: false,
      code: 'ENGINE_MODE_UNSUPPORTED',
    });
  });

  it('hidden external model selection projects to model.kind none', () => {
    const projected = projectEngineMode(
      { ...cliMode, connection: { kind: 'external', modelSelection: 'hidden' } },
      'x',
      'X'
    );
    expect(projected.model.kind).toBe('none');
  });

  it('exposes the default engine mode for dual-mode descriptors', () => {
    expect(defaultEngineModeFor(dualModeDescriptor)).toBe('cli');
    expect(defaultEngineModeFor({ engineModes: [cliMode] })).toBe(DEFAULT_ENGINE_MODE);
    expect(
      defaultEngineModeFor({
        engineModes: undefined,
        defaultEngineMode: undefined,
      })
    ).toBeNull();
  });
});
