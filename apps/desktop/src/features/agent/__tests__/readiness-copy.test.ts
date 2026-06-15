import { describe, it, expect } from 'vitest';
import { readinessGuidance } from '../readiness-copy.js';

describe('readinessGuidance', () => {
  it('no_agent → agents tab', () => {
    const g = readinessGuidance('no_agent');
    expect(g.settingsTab).toBe('agents');
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.body.length).toBeGreaterThan(0);
  });
  it('no_llm_profile → providers tab', () => {
    expect(readinessGuidance('no_llm_profile').settingsTab).toBe('providers');
  });
  it('no_credential → providers tab', () => {
    expect(readinessGuidance('no_credential').settingsTab).toBe('providers');
  });
  it('undefined reason falls back to providers tab with generic copy', () => {
    expect(readinessGuidance(undefined).settingsTab).toBe('providers');
  });
});
