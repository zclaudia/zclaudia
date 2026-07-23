import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { setGatewayClient } from '../../../../infra/gateway/gateway-instance.js';
import { buildTools } from '../tool-bridge.js';

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('EnterWorktree / ExitWorktree tools', () => {
  let db: Database.Database;
  let repo: string;
  const sessionId = 's-wt';

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.pragma('foreign_keys = OFF'); // minimal session row without project/agent rows
    // realpath so it matches git's resolved paths (macOS /private symlink).
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'zc-wt-tool-')));
    git(repo, 'init -b main');
    git(repo, 'config user.email t@t.t');
    git(repo, 'config user.name t');
    writeFileSync(path.join(repo, 'README.md'), 'hi\n');
    git(repo, 'add .');
    git(repo, 'commit -m init');
    // FK off: dummy project_id/agent_profile_id satisfy the NOT NULL columns without seeding parent rows.
    db.prepare(
      'INSERT INTO sessions (id, project_id, agent_profile_id, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sessionId, 'p-test', 'a-test', repo, Date.now(), Date.now());
  });

  afterEach(() => {
    setGatewayClient(null);
    rmSync(repo, { recursive: true, force: true });
    db.close();
  });

  function tools(): Record<string, any> {
    const built = buildTools(repo, { enabled: ['EnterWorktree', 'ExitWorktree'], db, sessionId });
    return Object.fromEntries(built.map(t => [t.name, t]));
  }

  function workingDir(): string | null {
    const row = db
      .prepare('SELECT working_directory FROM sessions WHERE id = ?')
      .get(sessionId) as { working_directory: string | null };
    return row.working_directory;
  }

  it('EnterWorktree creates a worktree and persists it as the session working directory', async () => {
    const res = await tools().EnterWorktree.execute('w1', { name: 'feature-x' });
    expect(res.details.ok).toBe(true);
    expect(res.details.path).toBe(path.join(repo, '.worktrees', 'sessions', 'feature-x'));
    expect(res.details.branch).toBe('worktree/feature-x');
    expect(existsSync(path.join(res.details.path, 'README.md'))).toBe(true);
    expect(workingDir()).toBe(res.details.path);
    expect(res.content[0].text).toMatch(/next turn|subsequent|going forward/i);
  });

  it('EnterWorktree refuses when not a git repository', async () => {
    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'zc-plain-')));
    const built = buildTools(plain, { enabled: ['EnterWorktree'], db, sessionId });

    const res = await (built[0] as any).execute('w1', { name: 'x' });
    rmSync(plain, { recursive: true, force: true });
    expect(res.details.error).toBe('not_a_git_repo');
  });

  it('EnterWorktree refuses when already inside a worktree', async () => {
    await tools().EnterWorktree.execute('w1', { name: 'first' });
    // Simulate the next run starting in the worktree by rebuilding tools with that cwd.
    const wtPath = workingDir()!;
    const built = buildTools(wtPath, { enabled: ['EnterWorktree'], db, sessionId });

    const res = await (built[0] as any).execute('w2', { name: 'second' });
    expect(res.details.error).toBe('already_in_worktree');
  });

  it('ExitWorktree (keep) restores the working directory and leaves the worktree', async () => {
    await tools().EnterWorktree.execute('w1', { name: 'feature-x' });
    const wtPath = workingDir()!;
    // Next run is in the worktree:
    const built = buildTools(wtPath, { enabled: ['ExitWorktree'], db, sessionId });

    const res = await (built[0] as any).execute('x1', { action: 'keep' });
    expect(res.details.ok).toBe(true);
    expect(res.details.removed).toBe(false);
    expect(workingDir()).toBe(repo);
    expect(existsSync(wtPath)).toBe(true);
  });

  it('ExitWorktree (remove) restores cwd and deletes a clean worktree', async () => {
    await tools().EnterWorktree.execute('w1', { name: 'feature-x' });
    const wtPath = workingDir()!;
    const built = buildTools(wtPath, { enabled: ['ExitWorktree'], db, sessionId });

    const res = await (built[0] as any).execute('x1', { action: 'remove' });
    expect(res.details.ok).toBe(true);
    expect(res.details.removed).toBe(true);
    expect(workingDir()).toBe(repo);
    expect(existsSync(wtPath)).toBe(false);
  });

  it('ExitWorktree (remove) keeps a dirty worktree but still restores cwd', async () => {
    await tools().EnterWorktree.execute('w1', { name: 'feature-x' });
    const wtPath = workingDir()!;
    writeFileSync(path.join(wtPath, 'wip.txt'), 'in progress\n');
    const built = buildTools(wtPath, { enabled: ['ExitWorktree'], db, sessionId });

    const res = await (built[0] as any).execute('x1', { action: 'remove' });
    expect(res.details.ok).toBe(true);
    expect(res.details.removed).toBe(false);
    expect(workingDir()).toBe(repo);
    expect(existsSync(wtPath)).toBe(true);
  });

  it('ExitWorktree errors when not currently in a worktree', async () => {
    const res = await tools().ExitWorktree.execute('x1', { action: 'keep' });
    expect(res.details.error).toBe('not_in_worktree');
  });

  it('normalizes the persisted working directory against the project root (root collapses to NULL)', async () => {
    // Seed the project row so normalization can compare against root_path.
    db.prepare(
      'INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('p-test', 'proj', repo, Date.now(), Date.now());

    await tools().EnterWorktree.execute('w1', { name: 'feature-x' });
    // Entering persists the normalized absolute worktree path (no trailing sep).
    expect(workingDir()).toBe(
      path.normalize(path.join(repo, '.worktrees', 'sessions', 'feature-x'))
    );

    const wtPath = workingDir()!;
    const built = buildTools(wtPath, { enabled: ['ExitWorktree'], db, sessionId });
    const res = await (built[0] as any).execute('x1', { action: 'keep' });

    expect(res.details.ok).toBe(true);
    // Back at the project root, the column collapses to NULL so the session
    // falls back to projects.root_path — same semantics as run-bootstrap.
    expect(workingDir()).toBeNull();
  });

  it('broadcasts a session update after changing the working directory', async () => {
    const broadcastSessionEvent = vi.fn();
    setGatewayClient({
      commands: { backendData: { broadcastSessionEvent } },
    } as any);

    await tools().EnterWorktree.execute('w1', { name: 'feature-x' });

    expect(broadcastSessionEvent).toHaveBeenCalledWith(
      'updated',
      expect.objectContaining({ id: sessionId })
    );
  });
});
