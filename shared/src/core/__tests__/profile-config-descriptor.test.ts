import { describe, it, expect } from 'vitest';
import {
  getProfileConfigDescriptor,
  enabledRuntimeDescriptors,
  runtimeRequiresLlmProfile,
  PROFILE_CONFIG_DESCRIPTORS,
} from '../profile-config-descriptor.js';

describe('profile config descriptors', () => {
  it('zclaudia binds an LLM profile and supports fallback', () => {
    const d = getProfileConfigDescriptor('zclaudia');
    expect(d.model.kind).toBe('llm-profile');
    expect(d.model.multimodalFallback).toBe(true);
    expect(d.capabilities.tools).toBe('profile');
    expect(runtimeRequiresLlmProfile('zclaudia')).toBe(true);
  });

  it('claude uses a native model, no fallback, native-readonly tools', () => {
    const d = getProfileConfigDescriptor('claude');
    expect(d.model.kind).toBe('native');
    expect(d.model.multimodalFallback).toBe(false);
    expect(d.capabilities.tools).toBe('native-readonly');
    expect(d.capabilities.providers).toBe('external');
    expect(runtimeRequiresLlmProfile('claude')).toBe(false);
  });

  it('defaults to the zclaudia descriptor when runtime is undefined', () => {
    expect(getProfileConfigDescriptor(undefined).runtime).toBe('zclaudia');
  });

  it('only exposes enabled runtimes in the selector list', () => {
    const enabled = enabledRuntimeDescriptors().map(d => d.runtime);
    expect(enabled).toContain('zclaudia');
    expect(enabled).toContain('claude');
    expect(enabled).not.toContain('codex');
    expect(enabled).not.toContain('cursor');
  });

  it('covers every AgentRuntimeType', () => {
    expect(Object.keys(PROFILE_CONFIG_DESCRIPTORS).sort()).toEqual([
      'claude',
      'codex',
      'cursor',
      'zclaudia',
    ]);
  });
});
