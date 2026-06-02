import { describe, it, expect } from 'vitest';
import type { AgentProfileConfig, ThinkingLevel } from '../agent-profile.js';
import { ALL_TOOL_NAMES, type ToolName, isToolName } from '../tools.js';

describe('AgentProfileConfig type shape', () => {
  it('accepts minimal config', () => {
    const cfg: AgentProfileConfig = {
      id: 'a1',
      name: 'coder',
      llmProfileId: 'lp1',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a coder.',
      enabledTools: ['read', 'write'],
      contextWindow: null,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(cfg.name).toBe('coder');
  });

  it('accepts full config with description + thinkingLevel + isDefault', () => {
    const lvl: ThinkingLevel = 'medium';
    const cfg: AgentProfileConfig = {
      id: 'a2',
      name: 'reviewer',
      description: 'Code review specialist',
      llmProfileId: 'lp1',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a reviewer.',
      enabledTools: ['read', 'grep', 'find', 'ls'],
      thinkingLevel: lvl,
      isDefault: true,
      contextWindow: 200_000,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(cfg.thinkingLevel).toBe('medium');
  });
});

describe('ALL_TOOL_NAMES', () => {
  it('contains exactly the 7 pi-coding-agent tools', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  });
});

describe('isToolName guard', () => {
  it('returns true for known tools', () => {
    expect(isToolName('read')).toBe(true);
    expect(isToolName('bash')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isToolName('nonexistent')).toBe(false);
    expect(isToolName('')).toBe(false);
  });
});
