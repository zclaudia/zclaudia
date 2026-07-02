import { describe, it, expect } from 'vitest';
import { diffPrefixForCacheAudit } from '../context-snapshot.js';

describe('diffPrefixForCacheAudit', () => {
  const tools = [{ name: 'Read', description: 'd', parameters: {} }];

  it('reports stable=true when prefix bytes are identical run-to-run', () => {
    const first = diffPrefixForCacheAudit('sessX', 'SYS', 'CAT', tools);
    expect(first.firstRun).toBe(true);
    const second = diffPrefixForCacheAudit('sessX', 'SYS', 'CAT', tools);
    expect(second.firstRun).toBe(false);
    expect(second.promptStable).toBe(true);
    expect(second.toolsStable).toBe(true);
  });

  it('flags promptStable=false when the system prompt text changes', () => {
    diffPrefixForCacheAudit('sessY', 'SYS', 'CAT', tools);
    const changed = diffPrefixForCacheAudit('sessY', 'SYS-DIFFERENT', 'CAT', tools);
    expect(changed.promptStable).toBe(false);
    expect(changed.toolsStable).toBe(true);
  });

  it('flags toolsStable=false when the tool set changes', () => {
    diffPrefixForCacheAudit('sessZ', 'SYS', 'CAT', tools);
    const changed = diffPrefixForCacheAudit('sessZ', 'SYS', 'CAT', [
      ...tools,
      { name: 'Bash', description: 'b', parameters: {} },
    ]);
    expect(changed.toolsStable).toBe(false);
  });
});
