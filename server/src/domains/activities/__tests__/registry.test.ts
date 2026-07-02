import { describe, it, expect, vi } from 'vitest';
import { ActivityRegistry } from '../registry.js';
import { GitCommitActivity } from '../git/git-commit.js';
import { GitStageActivity } from '../git/git-stage.js';
import type { Activity, ActivityServices } from '../types.js';

const services: ActivityServices = { agentLoopRunner: {} as never };

function fakeActivity(type: string): Activity {
  return {
    type,
    name: type,
    description: `${type} activity`,
    category: 'Test',
    invoke: vi.fn(async () => ({ status: 'completed', output: { ok: true } })),
  };
}

describe('ActivityRegistry', () => {
  it('registers, reports has/types, and dispatches invoke', async () => {
    const r = new ActivityRegistry();
    const a = fakeActivity('echo');
    r.register(a);
    expect(r.has('echo')).toBe(true);
    expect(r.types()).toEqual(['echo']);
    const res = await r.invoke('echo', { x: 1 }, services);
    expect(res).toEqual({ status: 'completed', output: { ok: true } });
    expect(a.invoke).toHaveBeenCalledWith({ x: 1 }, services);
  });

  it('returns a failed result for an unknown type', async () => {
    const r = new ActivityRegistry();
    const res = await r.invoke('nope', {}, services);
    expect(res.status).toBe('failed');
    expect(res.error).toContain('nope');
  });

  it('rejects duplicate registration', () => {
    const r = new ActivityRegistry();
    r.register(fakeActivity('dup'));
    expect(() => r.register(fakeActivity('dup'))).toThrow(/dup/);
  });

  it('listMeta returns catalog metadata for each registered activity', () => {
    const r = new ActivityRegistry();
    r.register({
      type: 'demo',
      name: 'Demo',
      description: 'A demo',
      category: 'Test',
      icon: 'Beaker',
      configSchema: { type: 'object', properties: {}, required: [] },
      invoke: vi.fn(async () => ({ status: 'completed', output: {} })),
    });
    expect(r.listMeta()).toEqual([
      {
        type: 'demo',
        name: 'Demo',
        description: 'A demo',
        category: 'Test',
        icon: 'Beaker',
        configSchema: { type: 'object', properties: {}, required: [] },
        source: 'activity',
      },
    ]);
  });

  it('GitCommitActivity has supportsLoop:true in listMeta; GitStageActivity does not', () => {
    const r = new ActivityRegistry();
    r.register(new GitCommitActivity());
    r.register(new GitStageActivity());
    const meta = r.listMeta();
    const commitMeta = meta.find(m => m.type === 'git_commit');
    const stageMeta = meta.find(m => m.type === 'git_stage');
    expect(commitMeta).toBeDefined();
    expect(commitMeta?.supportsLoop).toBe(true);
    expect(stageMeta).toBeDefined();
    expect(stageMeta?.supportsLoop).toBeUndefined();
  });
});
