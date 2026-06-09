import { describe, expect, it, vi } from 'vitest';
import { McpInventoryCache } from '../mcp-inventory-cache.js';

describe('McpInventoryCache', () => {
  it('caches inventory by server and config hash', async () => {
    const listTools = vi.fn().mockResolvedValue([{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }]);
    const listResources = vi.fn().mockResolvedValue([{ uri: 'file://a', name: 'A' }]);
    const listPrompts = vi.fn().mockResolvedValue([{ name: 'summarize', description: 'Summarize' }]);
    const cache = new McpInventoryCache({ now: () => 1000 });

    const first = await cache.getInventory('github', { command: 'node', args: ['a'] }, {
      listTools,
      listResources,
      listPrompts,
    });
    const second = await cache.getInventory('github', { command: 'node', args: ['a'] }, {
      listTools,
      listResources,
      listPrompts,
    });

    expect(second).toBe(first);
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(listResources).toHaveBeenCalledTimes(1);
    expect(listPrompts).toHaveBeenCalledTimes(1);
    expect(first.summary).toEqual({ tools: 1, resources: 1, prompts: 1, cachedAt: 1000 });
  });

  it('invalidates inventory explicitly and when config changes', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce([{ name: 'one', description: '', inputSchema: {} }])
      .mockResolvedValueOnce([{ name: 'two', description: '', inputSchema: {} }])
      .mockResolvedValueOnce([{ name: 'three', description: '', inputSchema: {} }]);
    const cache = new McpInventoryCache();
    const loaders = { listTools };

    await cache.getInventory('srv', { command: 'node', args: ['a'] }, loaders);
    await cache.getInventory('srv', { command: 'node', args: ['b'] }, loaders);
    cache.invalidate('srv');
    const refreshed = await cache.getInventory('srv', { command: 'node', args: ['b'] }, loaders);

    expect(listTools).toHaveBeenCalledTimes(3);
    expect(refreshed.tools[0].name).toBe('three');
  });
});
