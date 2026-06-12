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
});
