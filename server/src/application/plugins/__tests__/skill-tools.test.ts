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
  getEligibleDiscoveredSkills,
  loadDiscoveredSkillContent,
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

  it('returns eligible discovered skills without requirements-gated entries', async () => {
    writeSkill(
      WORKSPACE_SKILLS_DIR,
      'win-only',
      'name: win-only\ndescription: gated\nrequires:\n  os:\n    - win32',
    );
    writeSkill(WORKSPACE_SKILLS_DIR, 'ok', 'name: ok\ndescription: no gate');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);

    const eligible = getEligibleDiscoveredSkills();

    expect(eligible.map((skill) => skill.id)).toContain('ok');
    if (process.platform !== 'win32') {
      expect(eligible.map((skill) => skill.id)).not.toContain('win-only');
    }
  });

  it('projects nested skill execution metadata from SKILL.md frontmatter', async () => {
    writeSkill(
      WORKSPACE_SKILLS_DIR,
      'forked',
      [
        'name: forked',
        'description: forked skill',
        'execution:',
        '  allowed_modes:',
        '    - inline',
        '    - fork',
        '  default_mode: fork',
        '  fork_tool_policy: web',
      ].join('\n'),
    );
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);

    expect(getDiscoveredSkills()[0].execution).toEqual({
      allowedModes: ['inline', 'fork'],
      defaultMode: 'fork',
      forkToolPolicy: 'web',
    });
  });

  it('projects flat skill execution metadata aliases and ignores invalid metadata', async () => {
    writeSkill(
      WORKSPACE_SKILLS_DIR,
      'flat',
      [
        'name: flat',
        'description: flat skill',
        'allowed_modes: [fork, invalid, fork]',
        'default_mode: inline',
        'fork_tool_policy: dangerous',
      ].join('\n'),
    );
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);

    expect(getDiscoveredSkills()[0].execution).toEqual({
      allowedModes: ['fork'],
      defaultMode: 'inline',
    });
  });

  it('loads full SKILL.md content for cached workspace, external, and plugin skills', async () => {
    writeSkill(WORKSPACE_SKILLS_DIR, 'workspace-one', 'name: workspace-one\ndescription: ws', '# Workspace\n');
    const extDir = path.join(process.env.HOME!, '.agents', 'skills');
    writeSkill(extDir, 'external-one', 'name: external-one\ndescription: ext', '# External\n');
    const pluginDir = path.join(tmpRoot, 'plugin-skills');
    writeSkill(pluginDir, 'plugin-one', 'name: plugin-one\ndescription: plugin', '# Plugin\n');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);
    const pluginResult = await import('../skill-loader.js').then(({ loadAllSkills }) =>
      loadAllSkills(env, [{ path: pluginDir, source: 'plugin' as const }]),
    );
    addPluginSkills(pluginResult.skills);

    await expect(loadDiscoveredSkillContent({ source: 'workspace', id: 'workspace-one' }))
      .resolves.toContain('# Workspace');
    await expect(loadDiscoveredSkillContent({ source: 'external', id: 'external-one' }))
      .resolves.toContain('# External');
    await expect(loadDiscoveredSkillContent({ source: 'plugin', id: 'plugin-one' }))
      .resolves.toContain('# Plugin');
    await expect(loadDiscoveredSkillContent({ source: 'workspace', id: '../bad' }))
      .resolves.toBeNull();
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
