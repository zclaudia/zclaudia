import { describe, it, expect, vi } from 'vitest';
import { buildTools, ALL_TOOL_NAMES, type ToolName } from '../tool-bridge.js';

describe('buildTools', () => {
  it('returns all 7 tools by default', () => {
    const tools = buildTools('/tmp');
    expect(tools).toHaveLength(7);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  });

  it('filters by `enabled`', () => {
    const tools = buildTools('/tmp', { enabled: ['read', 'bash'] });
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name).sort()).toEqual(['bash', 'read']);
  });

  it('applies `overrides` to replace specific implementations', () => {
    const mockRead = {
      name: 'read',
      label: 'My Read',
      description: 'override',
      parameters: { type: 'object', properties: {}, required: [] } as any,
      execute: async () => ({ content: [{ type: 'text' as const, text: 'overridden' }] }),
    };
    const tools = buildTools('/tmp', { overrides: { read: mockRead as any } });
    const read = tools.find(t => t.name === 'read');
    expect((read as any)?.label).toBe('My Read');
  });

  it('warns and skips unknown tool names in `enabled`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = buildTools('/tmp', { enabled: ['read', 'nonexistent' as ToolName] });
    expect(tools.map(t => t.name)).toEqual(['read']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    warn.mockRestore();
  });

  it('exports ALL_TOOL_NAMES as the canonical 7-name list', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  });
});
