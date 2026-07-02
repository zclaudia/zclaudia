import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadAndCachePluginSkills } from '../skill-bootstrap.js';
import {
  getDiscoveredSkills,
  loadAndCacheSkills,
  setDatabase,
  refreshSkillCache,
} from '../skill-tools.js';
import { createExecutionEnv } from '../../../infra/execution-env.js';
import { workspaceService } from '../../services/workspace.js';

/**
 * Same caveat as skill-tools.test.ts: workspaceService.getWorkspaceDir() is
 * cached at module init from ZCLAUDIA_DATA_DIR, so we reuse whatever path
 * it returns and reset it between tests.
 */
const WORKSPACE_SKILLS_DIR = path.join(workspaceService.getWorkspaceDir(), 'skills');

function writeSkill(dir: string, name: string, frontmatter = '', body = `# ${name}\n`) {
  const skillDir = path.join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
  writeFileSync(path.join(skillDir, 'SKILL.md'), content);
}

interface FakePluginLoader {
  getPluginSkillDirs(): Array<{ path: string; source: 'plugin' }>;
}

describe('loadAndCachePluginSkills', () => {
  let tmpRoot: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-sb-'));
    originalHome = process.env.HOME;
    // Isolate well-known external dirs so developer-machine skills don't leak in.
    process.env.HOME = path.join(tmpRoot, 'home-no-skills');
    mkdirSync(process.env.HOME, { recursive: true });
    // Reset workspace skills dir so cross-test pollution is impossible.
    rmSync(WORKSPACE_SKILLS_DIR, { recursive: true, force: true });
    mkdirSync(WORKSPACE_SKILLS_DIR, { recursive: true });
    setDatabase(new Database(':memory:'));
    // Reset the module-level cache.
    await refreshSkillCache(createExecutionEnv(tmpRoot));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(WORKSPACE_SKILLS_DIR, { recursive: true, force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns 0 when plugin loader has no skill dirs', async () => {
    const env = createExecutionEnv(tmpRoot);
    const fakeLoader: FakePluginLoader = { getPluginSkillDirs: () => [] };
    const count = await loadAndCachePluginSkills(env, fakeLoader as never);
    expect(count).toBe(0);
  });

  it('injects plugin skills into the shared cache', async () => {
    const pluginDir = path.join(tmpRoot, 'plugin-a');
    mkdirSync(pluginDir, { recursive: true });
    writeSkill(pluginDir, 'plugin-skill-1', 'name: plugin-skill-1\ndescription: from plugin');
    const env = createExecutionEnv(tmpRoot);
    const fakeLoader: FakePluginLoader = {
      getPluginSkillDirs: () => [{ path: pluginDir, source: 'plugin' }],
    };
    const count = await loadAndCachePluginSkills(env, fakeLoader as never);
    expect(count).toBe(1);
    const plugin = getDiscoveredSkills().find(s => s.source === 'plugin');
    expect(plugin?.name).toBe('plugin-skill-1');
  });

  it('skips plugin skills whose id collides with an already-cached skill', async () => {
    // Workspace pre-populated with a 'shared' skill.
    writeSkill(WORKSPACE_SKILLS_DIR, 'shared', 'name: ws-shared\ndescription: workspace');
    const env = createExecutionEnv(tmpRoot);
    await loadAndCacheSkills(env);

    const pluginDir = path.join(tmpRoot, 'plugin-x');
    mkdirSync(pluginDir, { recursive: true });
    writeSkill(pluginDir, 'shared', 'name: plugin-shared\ndescription: plugin loses');
    const fakeLoader: FakePluginLoader = {
      getPluginSkillDirs: () => [{ path: pluginDir, source: 'plugin' }],
    };
    await loadAndCachePluginSkills(env, fakeLoader as never);
    const shared = getDiscoveredSkills().filter(s => s.id === 'shared');
    expect(shared).toHaveLength(1);
    expect(shared[0].source).toBe('workspace');
    expect(shared[0].name).toBe('ws-shared');
  });

  it('plugin skill is cached even when its requirements fail (just hidden from buildSkillDirectoryHint)', async () => {
    const pluginDir = path.join(tmpRoot, 'plugin-y');
    mkdirSync(pluginDir, { recursive: true });
    writeSkill(
      pluginDir,
      'gated',
      'name: gated\ndescription: needs win32\nrequires:\n  os:\n    - win32'
    );
    const env = createExecutionEnv(tmpRoot);
    const fakeLoader: FakePluginLoader = {
      getPluginSkillDirs: () => [{ path: pluginDir, source: 'plugin' }],
    };
    await loadAndCachePluginSkills(env, fakeLoader as never);
    expect(getDiscoveredSkills().find(s => s.id === 'gated')).toBeDefined();
  });
});
