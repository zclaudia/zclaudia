import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitStageActivity } from '../git-stage.js';

function initRepo(dir: string) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
}

describe('GitStageActivity', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitstage-'));
    initRepo(repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('stages all changes and reports the staged files', async () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    const res = await new GitStageActivity().invoke({ projectRootPath: repo });
    expect(res.status).toBe('completed');
    expect(res.output.hasChanges).toBe(true);
    expect(res.output.count).toBe(1);
    expect(res.output.stagedFiles).toContain('a.txt');
  });

  it('completes with no changes on a clean tree (not failed)', async () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    const res = await new GitStageActivity().invoke({ projectRootPath: repo });
    expect(res.status).toBe('completed');
    expect(res.output.hasChanges).toBe(false);
    expect(res.output.count).toBe(0);
  });

  it('fails when no working directory is given', async () => {
    const res = await new GitStageActivity().invoke({});
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/working directory/i);
  });
});
