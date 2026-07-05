import { describe, it, expect } from 'vitest';
import { readinessGuidance } from '../readiness-copy.js';

describe('readinessGuidance', () => {
  it('no_agent → agents shell mode (default tab)', () => {
    const g = readinessGuidance('no_agent');
    expect(g.destination).toEqual({ kind: 'agents' });
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.body.length).toBeGreaterThan(0);
  });
  it('no_model → agents shell mode (default tab)', () => {
    expect(readinessGuidance('no_model').destination).toEqual({ kind: 'agents' });
  });
  it('no_llm_profile → agents providers tab', () => {
    expect(readinessGuidance('no_llm_profile').destination).toEqual({
      kind: 'agents',
      tab: 'providers',
    });
  });
  it('no_credential → agents providers tab', () => {
    expect(readinessGuidance('no_credential').destination).toEqual({
      kind: 'agents',
      tab: 'providers',
    });
  });
  it('undefined reason falls back to the agents providers tab with generic copy', () => {
    expect(readinessGuidance(undefined).destination).toEqual({
      kind: 'agents',
      tab: 'providers',
    });
  });
});
