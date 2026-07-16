import { describe, it, expect } from 'vitest';
import { recordChip } from './record-status.js';
import { resolveLlmProfileStatus, resolveMcpServerStatus, resolveSkillStatus, resolveAgentProfileStatus } from './record-status-resolvers.js';

describe('resolveLlmProfileStatus', () => {
  it('ready + usable when it has a model and a credential', () => {
    const s = resolveLlmProfileStatus({ hasModel: true, hasCredential: true });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true } });
    expect(recordChip(s)).toBe('ready');
  });

  it('draft when it has no model (regardless of credential)', () => {
    expect(recordChip(resolveLlmProfileStatus({ hasModel: false, hasCredential: true }))).toBe('draft');
    expect(recordChip(resolveLlmProfileStatus({ hasModel: false, hasCredential: false }))).toBe('draft');
  });

  it('unavailable(no_credential) when complete but missing a credential', () => {
    const s = resolveLlmProfileStatus({ hasModel: true, hasCredential: false });
    expect(s.availability).toEqual({ usable: false, reason: 'no_credential' });
    expect(recordChip(s)).toBe('unavailable');
  });
});

describe('resolveMcpServerStatus', () => {
  it('ready + usable + enabled with an endpoint and a live connection', () => {
    const s = resolveMcpServerStatus({ hasEndpoint: true, enabled: true, connectionState: 'connected' });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true }, disabled: false });
    expect(recordChip(s)).toBe('ready');
  });

  it('draft when it has no endpoint', () => {
    expect(recordChip(resolveMcpServerStatus({ hasEndpoint: false, enabled: true }))).toBe('draft');
  });

  it('ready + usable with an endpoint when no connection state is known yet', () => {
    const s = resolveMcpServerStatus({ hasEndpoint: true, enabled: true });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true }, disabled: false });
    expect(recordChip(s)).toBe('ready');
  });

  it('unavailable(needs_auth) on a needs-auth connection', () => {
    const s = resolveMcpServerStatus({ hasEndpoint: true, enabled: true, connectionState: 'needs-auth' });
    expect(s.availability).toEqual({ usable: false, reason: 'needs_auth' });
    expect(recordChip(s)).toBe('unavailable');
  });

  it('unavailable(connect_failed) on a failed connection', () => {
    const s = resolveMcpServerStatus({ hasEndpoint: true, enabled: true, connectionState: 'failed' });
    expect(s.availability).toEqual({ usable: false, reason: 'connect_failed' });
  });

  it('disabled when not enabled (disabled outranks ready but not unavailable)', () => {
    expect(recordChip(resolveMcpServerStatus({ hasEndpoint: true, enabled: false, connectionState: 'connected' }))).toBe('disabled');
  });
});

describe('resolveSkillStatus', () => {
  it('ready + usable with meaningful content and requirements met', () => {
    const s = resolveSkillStatus({ contentMeaningful: true, eligible: true });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true } });
    expect(recordChip(s)).toBe('ready');
  });

  it('draft when content is not meaningful', () => {
    expect(recordChip(resolveSkillStatus({ contentMeaningful: false, eligible: true }))).toBe('draft');
  });

  it('unavailable(requirement_unmet) when complete but not eligible', () => {
    const s = resolveSkillStatus({ contentMeaningful: true, eligible: false });
    expect(s.availability).toEqual({ usable: false, reason: 'requirement_unmet' });
    expect(recordChip(s)).toBe('unavailable');
  });
});

describe('resolveAgentProfileStatus', () => {
  it('always ready + usable when the runtime does not require an LLM', () => {
    const s = resolveAgentProfileStatus({ requiresLlm: false, hasLlmBinding: false, hasModel: false, llmUsable: false });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true } });
  });

  it('ready + usable when it has a binding, a model, and the LLM is usable', () => {
    const s = resolveAgentProfileStatus({ requiresLlm: true, hasLlmBinding: true, hasModel: true, llmUsable: true });
    expect(s).toEqual({ completeness: 'ready', availability: { usable: true } });
    expect(recordChip(s)).toBe('ready');
  });

  it('draft when it lacks a binding or a model', () => {
    expect(recordChip(resolveAgentProfileStatus({ requiresLlm: true, hasLlmBinding: false, hasModel: false, llmUsable: false }))).toBe('draft');
    expect(recordChip(resolveAgentProfileStatus({ requiresLlm: true, hasLlmBinding: true, hasModel: false, llmUsable: true }))).toBe('draft');
  });

  it('unavailable(no_llm_profile) when complete-looking but no binding, or llm_unavailable when the bound LLM is broken', () => {
    // No binding but a model → draft dominates the chip, and availability names no_llm_profile.
    const noBind = resolveAgentProfileStatus({ requiresLlm: true, hasLlmBinding: false, hasModel: true, llmUsable: false });
    expect(noBind.availability).toEqual({ usable: false, reason: 'no_llm_profile' });
    expect(recordChip(noBind)).toBe('draft');
    // Bound + model but the LLM is unusable → complete, unavailable(llm_unavailable).
    const broken = resolveAgentProfileStatus({ requiresLlm: true, hasLlmBinding: true, hasModel: true, llmUsable: false });
    expect(broken.availability).toEqual({ usable: false, reason: 'llm_unavailable' });
    expect(recordChip(broken)).toBe('unavailable');
  });
});
