import { describe, it, expect } from 'vitest';
import { buildTools } from '../tool-bridge.js';

describe('tool-bridge Memory wiring', () => {
  it('includes Memory when memoryDir is provided', () => {
    const tools = buildTools('/tmp', { enabled: ['Memory'], memoryDir: '/tmp/mem' });
    expect(tools.map((t) => (t as any).name)).toContain('Memory');
  });

  it('skips Memory silently when memoryDir is absent', () => {
    const tools = buildTools('/tmp', { enabled: ['Memory'] });
    expect(tools.map((t) => (t as any).name)).not.toContain('Memory');
  });

  it('skips Memory in the default (no enabled list) tool set when memoryDir is absent', () => {
    const tools = buildTools('/tmp');
    expect(tools.map((t) => (t as any).name)).not.toContain('Memory');
  });

  it('includes Memory in the default tool set when memoryDir is provided', () => {
    const tools = buildTools('/tmp', { memoryDir: '/tmp/mem' });
    expect(tools.map((t) => (t as any).name)).toContain('Memory');
  });

  it('an override cannot bypass the memoryDir guard', () => {
    const mockTool = { name: 'Memory', label: 'Memory', execute: async () => ({ content: [], details: {} }) };
    const tools = buildTools('/tmp', { enabled: ['Memory'], overrides: { Memory: mockTool as any } });
    expect(tools).toHaveLength(0);
  });
});
