import { describe, it, expect, beforeEach } from 'vitest';
import { promoteRuleToProjectOverride } from '../permission-rule-promotion.js';

// ============================================
// Minimal mock DB
// ============================================

type Row = { agent_permission_override: string | null };

function makeMockDb(initial: Record<string, Row> = {}) {
  const store: Record<string, Row> = { ...initial };
  let lastUpdateSql: string | undefined;

  function prepare(sql: string) {
    lastUpdateSql = undefined;
    return {
      get: (...args: unknown[]) => {
        const projectId = args[0] as string;
        return store[projectId];
      },
      run: (...args: unknown[]) => {
        // UPDATE projects SET agent_permission_override = ?, updated_at = ? WHERE id = ?
        const override = args[0] as string;
        const projectId = args[2] as string;
        lastUpdateSql = sql;
        store[projectId] = { agent_permission_override: override };
      },
    };
  }

  return {
    prepare,
    savedOverride: (projectId: string) => store[projectId]?.agent_permission_override ?? null,
    wasUpdated: () => lastUpdateSql !== undefined && lastUpdateSql.includes('UPDATE'),
  };
}

describe('promoteRuleToProjectOverride', () => {
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    db = makeMockDb({
      'proj-1': { agent_permission_override: null },
    });
  });

  it('appends a parsed approve rule to the project override', () => {
    expect(promoteRuleToProjectOverride(db, 'proj-1', 'Bash(git push *)')).toBe(true);
    const saved = JSON.parse(db.savedOverride('proj-1')!);
    expect(saved.customRules).toEqual([
      { toolName: 'Bash', pattern: '^git push(\\s.*)?$', action: 'approve' },
    ]);
  });

  it('dedupes identical rules', () => {
    promoteRuleToProjectOverride(db, 'proj-1', 'Bash(git push *)');
    promoteRuleToProjectOverride(db, 'proj-1', 'Bash(git push *)');
    const saved = JSON.parse(db.savedOverride('proj-1')!);
    expect(saved.customRules).toHaveLength(1);
  });

  it('returns false and writes nothing on unparseable text', () => {
    const db2 = makeMockDb({ 'proj-1': { agent_permission_override: null } });
    expect(promoteRuleToProjectOverride(db2, 'proj-1', 'Bash(broken')).toBe(false);
    expect(db2.savedOverride('proj-1')).toBeNull();
  });

  it('preserves existing override fields', () => {
    const existingOverride = JSON.stringify({ profile: { fileRead: 'ask' } });
    const db2 = makeMockDb({ 'proj-1': { agent_permission_override: existingOverride } });
    expect(promoteRuleToProjectOverride(db2, 'proj-1', 'Bash(npm run *)')).toBe(true);
    const saved = JSON.parse(db2.savedOverride('proj-1')!);
    expect(saved.profile).toEqual({ fileRead: 'ask' });
    expect(saved.customRules).toHaveLength(1);
    expect(saved.customRules[0].toolName).toBe('Bash');
  });

  it('recovers from corrupt override JSON', () => {
    const db2 = makeMockDb({ 'proj-1': { agent_permission_override: '{not json' } });
    expect(promoteRuleToProjectOverride(db2, 'proj-1', 'Read')).toBe(true);
    const saved = JSON.parse(db2.savedOverride('proj-1')!);
    expect(saved.customRules).toEqual([{ toolName: 'Read', action: 'approve' }]);
  });
});
