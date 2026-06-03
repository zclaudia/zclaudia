import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  loadAndCacheSkills,
  refreshSkillCache,
  buildSkillDirectoryHint,
  getDiscoveredSkills,
  addPluginSkills,
  setDatabase,
} from '../skill-tools.js';
import { createExecutionEnv } from '../../../infra/execution-env.js';
import { workspaceService } from '../../services/workspace.js';

/**
 * `workspaceService.getWorkspaceDir()` is cached at module-init from
 * `ZCLAUDIA_DATA_DIR`, so we can't redirect it per-test via env override.
 * Instead, write fixtures into whatever path the service already returned
 * and clean those directories after each test.
 */
const WORKSPACE_SKILLS_DIR = path.join(workspaceService.getWorkspaceDir(), 'skills');

function writeSkill(dir: string, name: string, frontmatter = '', body = `# ${name}\n`) {
  const skillDir = path.join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
  writeFileSync(path.join(skillDir, 'SKILL.md'), content);
}

function db() {
  return new Database(':memory:');
}

function ensureAppConfigTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

describe('skill-tools (pi-backed)', () => {
  let tmpRoot: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-st-'));
    originalHome = process.env.HOME;
    // Point HOME at an empty dir so well-known external dirs (~/.zclaudia/skills,
    // ~/.agents/skills) are absent and don't leak from the developer machine.
    process.env.HOME = path.join(tmpRoot, 'home-no-skills');
    mkdirSync(process.env.HOME, { recursive: true });
    // Reset the workspace skills dir between tests.
    rmSync(WORKSPACE_SKILLS_DIR, { recursive: true, force: true });
    mkdirSync(WORKSPACE_SKILLS_DIR, { recursive: true });
    const memDb = db();
    ensureAppConfigTable(memDb);
    setDatabase(memDb);
    // Module-level skill cache persists across tests; reset it by loading
    // from the now-empty workspace dir.
    await refreshSkillCache(createExecutionEnv(tmpRoot));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(WORKSPACE_SKILLS_DIR, { recursive: true, force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loadAndCacheSkills loads workspace skills', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'a', 'name: a\ndescription: skill a');
    const env = createExecutionEnv(tmpRoot);
    const count = await loadAndCacheSkills(env);
    expect(count).toBe(1);
    expect(getDiscoveredSkills()).toHaveLength(1);
    expect(getDiscoveredSkills()[0].source).toBe('workspace');
  });

  it('dedups same-id skills, workspace winning over external', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'shared', 'name: workspace-shared\ndescription: ws');
    const extDir = path.join(process.env.HOME!, '.zclaudia', 'skills');
    mkdirSync(extDir, { recursive: true });
    writeSkill(extDir, 'shared', 'name: external-shared\ndescription: ext');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    const discovered = getDiscoveredSkills();
    expect(discovered).toHaveLength(1);
    expect(discovered[0].name).toBe('workspace-shared');
  });

  it('buildSkillDirectoryHint outputs pi XML containing each skill name + description', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'alpha', 'name: alpha\ndescription: first');
    writeSkill(WORKSPACE_SKILLS_DIR, 'beta', 'name: beta\ndescription: second');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    const hint = buildSkillDirectoryHint();
    expect(hint).toContain('<available_skills>');
    expect(hint).toContain('alpha');
    expect(hint).toContain('first');
    expect(hint).toContain('beta');
    expect(hint).toContain('second');
  });

  it('buildSkillDirectoryHint returns empty string when no eligible skills', () => {
    expect(buildSkillDirectoryHint()).toBe('');
  });

  it('buildSkillDirectoryHint filters out skills whose requirements fail', async () => {
    writeSkill(
      WORKSPACE_SKILLS_DIR,
      'win-only',
      'name: win-only\ndescription: gated\nrequires:\n  os:\n    - win32',
    );
    writeSkill(WORKSPACE_SKILLS_DIR, 'ok', 'name: ok\ndescription: no gate');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    const hint = buildSkillDirectoryHint();
    if (process.platform !== 'win32') {
      expect(hint).not.toContain('win-only');
    }
    expect(hint).toContain('ok');
  });

  it('refreshSkillCache resets and reloads', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'first', 'name: first\ndescription: one');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    expect(getDiscoveredSkills()).toHaveLength(1);
    writeSkill(WORKSPACE_SKILLS_DIR, 'second', 'name: second\ndescription: two');
    await refreshSkillCache(env);
    expect(getDiscoveredSkills()).toHaveLength(2);
  });

  it('addPluginSkills appends and dedups against existing cache', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'shared', 'name: ws-shared\ndescription: ws');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    addPluginSkills([
      {
        skill: { name: 'shared', description: 'plugin attempt', content: '', filePath: '/plugin/shared/SKILL.md' },
        source: 'plugin',
      },
      {
        skill: { name: 'plugin-only', description: 'unique', content: '', filePath: '/plugin/plugin-only/SKILL.md' },
        source: 'plugin',
      },
    ]);
    const discovered = getDiscoveredSkills();
    expect(discovered).toHaveLength(2);
    expect(discovered.find((s) => s.source === 'workspace')?.name).toBe('ws-shared');
    expect(discovered.find((s) => s.source === 'plugin')?.name).toBe('plugin-only');
  });
});
