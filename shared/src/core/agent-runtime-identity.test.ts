import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_RUNTIME,
  BUILTIN_AGENT_RUNTIME_TYPES,
  normalizeAgentRuntimeType,
  isPiAgentRuntime,
} from './agent-profile.js';
import {
  enabledRuntimeDescriptors,
  getProfileConfigDescriptor,
} from './profile-config-descriptor.js';

describe('runtime identity', () => {
  it('exposes Pi once and canonicalizes the old name without changing other runtime identities', () => {
    expect(DEFAULT_AGENT_RUNTIME).toBe('pi');
    expect(BUILTIN_AGENT_RUNTIME_TYPES).toEqual(['pi']);
    expect(normalizeAgentRuntimeType('zclaudia')).toBe('pi');
    expect(normalizeAgentRuntimeType(undefined)).toBe('pi');
    expect(normalizeAgentRuntimeType('future-agent')).toBe('future-agent');
    expect(normalizeAgentRuntimeType('')).toBe('');
    expect(getProfileConfigDescriptor('zclaudia')).toBe(getProfileConfigDescriptor('pi'));
    expect(enabledRuntimeDescriptors().map(d => [d.runtime, d.label])).toEqual([['pi', 'Pi']]);
  });

  it('limits Pi host behavior to Pi even when another runtime uses an LLM profile', () => {
    expect(isPiAgentRuntime('pi')).toBe(true);
    expect(isPiAgentRuntime('zclaudia')).toBe(true);
    expect(isPiAgentRuntime('claude')).toBe(false);
    expect(isPiAgentRuntime('codex')).toBe(false);
    expect(isPiAgentRuntime(undefined)).toBe(false);
  });
});
