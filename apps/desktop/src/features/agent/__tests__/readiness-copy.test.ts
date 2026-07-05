import { describe, it, expect } from 'vitest';
import { readinessGuidance } from '../readiness-copy.js';

describe('readinessGuidance', () => {
  it('no_agent → agents shell mode', () => {
    const g = readinessGuidance('no_agent');
    expect(g.destination).toEqual({ kind: 'agents' });
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.body.length).toBeGreaterThan(0);
  });
  it('no_llm_profile → providers tab', () => {
    expect(readinessGuidance('no_llm_profile').destination).toEqual({
      kind: 'settings',
      tab: 'providers',
    });
  });
  it('no_credential → providers tab', () => {
    expect(readinessGuidance('no_credential').destination).toEqual({
      kind: 'settings',
      tab: 'providers',
    });
  });
  it('undefined reason falls back to providers tab with generic copy', () => {
    expect(readinessGuidance(undefined).destination).toEqual({
      kind: 'settings',
      tab: 'providers',
    });
  });
});
