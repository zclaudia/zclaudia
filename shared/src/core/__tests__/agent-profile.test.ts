import { describe, it, expect } from 'vitest';
import type { AgentProfileConfig, ThinkingLevel } from '../agent-profile.js';
import { ALL_TOOL_NAMES, normalizeToolName, type ToolName, isToolName } from '../tools.js';

describe('AgentProfileConfig type shape', () => {
  it('accepts minimal config', () => {
    const cfg: AgentProfileConfig = {
      id: 'a1',
      name: 'coder',
      llmProfileId: 'lp1',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a coder.',
      enabledTools: ['read', 'write'],
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
      enabledTools: ['read', 'grep', 'ls'],
      thinkingLevel: lvl,
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(cfg.thinkingLevel).toBe('medium');
  });
});

describe('ALL_TOOL_NAMES', () => {
  it('contains the core coding tools and first-batch agent tools', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual([
      'Agent',
      'AskUserQuestion',
      'AstEdit',
      'AstGrep',
      'Bash',
      'Edit',
      'EnterPlanMode',
      'EnterWorktree',
      'Eval',
      'ExitPlanMode',
      'ExitWorktree',
      'Glob',
      'Grep',
      'LS',
      'LSPTool',
      'ListMcpResources',
      'MCPTool',
      'Memory',
      'Monitor',
      'Read',
      'ReadMcpResource',
      'TaskOutput',
      'TodoWrite',
      'ToolSearch',
      'WebFetch',
      'WebSearch',
      'Write',
    ]);
  });
});

describe('isToolName guard', () => {
  it('returns true for canonical tools', () => {
    expect(isToolName('Read')).toBe(true);
    expect(isToolName('Bash')).toBe(true);
    expect(isToolName('Glob')).toBe(true);
    expect(isToolName('WebFetch')).toBe(true);
    expect(isToolName('ToolSearch')).toBe(true);
    expect(isToolName('TaskOutput')).toBe(true);
    expect(isToolName('Monitor')).toBe(true);
    expect(isToolName('Agent')).toBe(true);
  });

  it('normalizes legacy lowercase aliases to canonical tools', () => {
    expect(normalizeToolName('read')).toBe('Read');
    expect(normalizeToolName('write')).toBe('Write');
    expect(normalizeToolName('edit')).toBe('Edit');
    expect(normalizeToolName('bash')).toBe('Bash');
    expect(normalizeToolName('grep')).toBe('Grep');
    expect(normalizeToolName('ls')).toBe('LS');
    expect(normalizeToolName('WebFetch')).toBe('WebFetch');
    expect(normalizeToolName('find')).toBeUndefined();
    expect(normalizeToolName('nonexistent')).toBeUndefined();
  });

  it('returns false for unknown strings', () => {
    expect(isToolName('nonexistent')).toBe(false);
    expect(isToolName('')).toBe(false);
  });
});
