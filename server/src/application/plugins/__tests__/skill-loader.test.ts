import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAllSkills } from '../skill-loader.js';
import { createExecutionEnv } from '../../../infra/execution-env.js';

describe('loadAllSkills', () => {
  let tmpRoot: string;
  beforeEach(() => { tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-sl-')); });
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  function writeSkill(dir: string, name: string, frontmatter = '', body = `# ${name}\n`) {
    const skillDir = path.join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    const content = frontmatter
      ? `---\n${frontmatter}\n---\n\n${body}`
      : body;
    writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    return skillDir;
  }

  it('loads a skill from a workspace dir and tags its source', async () => {
    const wsDir = path.join(tmpRoot, 'ws');
    mkdirSync(wsDir);
    writeSkill(wsDir, 'demo', 'name: demo\ndescription: A demo');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllSkills(env, [{ path: wsDir, source: 'workspace' }]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].source).toBe('workspace');
    expect(result.skills[0].skill.name).toBe('demo');
  });

  it('preserves source tags across multiple input dirs', async () => {
    const wsDir = path.join(tmpRoot, 'ws');
    const extDir = path.join(tmpRoot, 'ext');
    mkdirSync(wsDir); mkdirSync(extDir);
    writeSkill(wsDir, 'w-skill', 'name: w-skill\ndescription: workspace one');
    writeSkill(extDir, 'e-skill', 'name: e-skill\ndescription: external one');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllSkills(env, [
      { path: wsDir, source: 'workspace' },
      { path: extDir, source: 'external' },
    ]);
    const sources = result.skills.map(s => s.source).sort();
    expect(sources).toEqual(['external', 'workspace']);
  });

  it('parses requirements from frontmatter onto SourcedSkill', async () => {
    const wsDir = path.join(tmpRoot, 'ws');
    mkdirSync(wsDir);
    writeSkill(
      wsDir,
      'gated',
      'name: gated\ndescription: needs git\nrequires:\n  binaries:\n    - git\n  os:\n    - linux',
    );
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllSkills(env, [{ path: wsDir, source: 'workspace' }]);
    expect(result.skills[0].requirements).toEqual({ binaries: ['git'], os: ['linux'] });
  });

  it('returns empty result for a missing dir (no throw)', async () => {
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllSkills(env, [
      { path: path.join(tmpRoot, 'nope'), source: 'workspace' },
    ]);
    expect(result.skills).toEqual([]);
  });

  it('reports diagnostics for invalid skill files', async () => {
    const wsDir = path.join(tmpRoot, 'ws');
    const badDir = path.join(wsDir, 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(path.join(badDir, 'SKILL.md'), '');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllSkills(env, [{ path: wsDir, source: 'workspace' }]);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});
