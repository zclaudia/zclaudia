import { describe, it, expect } from 'vitest';
import {
  getProfileConfigDescriptor,
  enabledRuntimeDescriptors,
  runtimeRequiresLlmProfile,
  PROFILE_CONFIG_DESCRIPTORS,
} from '../profile-config-descriptor.js';

describe('profile config descriptors', () => {
  it('zclaudia binds an LLM profile and supports fallback', () => {
    const d = getProfileConfigDescriptor('pi');
    expect(d.model.kind).toBe('llm-profile');
    expect(d.model.multimodalFallback).toBe(true);
    expect(d.capabilities.tools).toBe('profile');
    expect(runtimeRequiresLlmProfile('pi')).toBe(true);
  });

  it('defaults to the Pi descriptor when runtime is undefined', () => {
    expect(getProfileConfigDescriptor(undefined).runtime).toBe('pi');
  });

  it('falls back to the Pi descriptor for runtimes contributed by plugins', () => {
    expect(getProfileConfigDescriptor('claude').runtime).toBe('pi');
  });

  it('only exposes enabled runtimes in the selector list', () => {
    const enabled = enabledRuntimeDescriptors().map(d => d.runtime);
    expect(enabled).toContain('pi');
  });

  it('only ships the built-in Pi descriptor; plugins add the rest', () => {
    expect(Object.keys(PROFILE_CONFIG_DESCRIPTORS).sort()).toEqual(['pi']);
  });
});
