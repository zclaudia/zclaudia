import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanCustomCommands, getGlobalCommandsDir, getProjectCommandsDir } from '../command-scanner.js';
import { createExecutionEnv } from '../../infra/execution-env.js';

describe('command-scanner', () => {
  let tmpHome: string;
  let tmpProject: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), 'zc-home-'));
    tmpProject = mkdtempSync(path.join(tmpdir(), 'zc-proj-'));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpProject, { recursive: true, force: true });
  });

  describe('getGlobalCommandsDir', () => {
    it('returns the correct global commands directory path', () => {
      const result = getGlobalCommandsDir();
      expect(result).toBe(path.join(tmpHome, '.claude', 'commands'));
    });
  });

  describe('getProjectCommandsDir', () => {
    it('returns the correct project commands directory path', () => {
      const result = getProjectCommandsDir('/projects/my-project');
      expect(result).toBe(path.join('/projects/my-project', '.claude', 'commands'));
    });
  });

  describe('scanCustomCommands', () => {
    it('returns empty array when directories do not exist', async () => {
      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});
      expect(result).toEqual([]);
    });

    it('scans global commands directory', async () => {
      const globalDir = path.join(tmpHome, '.claude', 'commands');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(path.join(globalDir, 'review.md'), '# Review code\nThis is a review command');
      writeFileSync(path.join(globalDir, 'fix.md'), '# Fix bugs\nFix logic');

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});

      expect(result).toHaveLength(2);
      const names = result.map(r => r.command).sort();
      expect(names).toEqual(['/fix', '/review']);
      const review = result.find(r => r.command === '/review');
      expect(review).toMatchObject({
        source: 'custom',
        scope: 'global',
        filePath: path.join(globalDir, 'review.md'),
      });
      // pi extracts the first non-empty line as the description fallback when no frontmatter.
      expect(review?.description).toContain('Review code');
    });

    it('scans project commands when projectRoot is provided', async () => {
      const projectDir = path.join(tmpProject, '.claude', 'commands');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(path.join(projectDir, 'deploy.md'), '# Deploy project\nDeploy to production');

      const env = createExecutionEnv(tmpProject);
      const result = await scanCustomCommands(env, { projectRoot: tmpProject });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        command: '/deploy',
        source: 'custom',
        scope: 'project',
        filePath: path.join(projectDir, 'deploy.md'),
      });
      expect(result[0].description).toContain('Deploy project');
    });

    it('project commands take precedence over global with same name (bare /name resolves to project)', async () => {
      const globalDir = path.join(tmpHome, '.claude', 'commands');
      const projectDir = path.join(tmpProject, '.claude', 'commands');
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(path.join(globalDir, 'shared.md'), '---\ndescription: Global version\n---\nbody');
      writeFileSync(path.join(projectDir, 'shared.md'), '---\ndescription: Project version\n---\nbody');

      const env = createExecutionEnv(tmpProject);
      const result = await scanCustomCommands(env, { projectRoot: tmpProject });

      // Collision: emits /user:shared, /project:shared, AND bare /shared (resolves to project).
      const names = result.map(r => r.command).sort();
      expect(names).toEqual(['/project:shared', '/shared', '/user:shared']);
      const bare = result.find(r => r.command === '/shared')!;
      expect(bare.description).toBe('Project version');
      expect(bare.scope).toBe('project');
    });

    it('extracts description from YAML frontmatter when present', async () => {
      const globalDir = path.join(tmpHome, '.claude', 'commands');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        path.join(globalDir, 'fm.md'),
        '---\ndescription: From frontmatter\n---\n\n# Heading\nBody',
      );

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});

      expect(result[0].description).toBe('From frontmatter');
    });

    it('truncates long descriptions', async () => {
      const globalDir = path.join(tmpHome, '.claude', 'commands');
      mkdirSync(globalDir, { recursive: true });
      const longLine = 'x'.repeat(100);
      writeFileSync(path.join(globalDir, 'long.md'), longLine);

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});

      expect(result[0].description.length).toBeLessThanOrEqual(80);
      expect(result[0].description.endsWith('...')).toBe(true);
    });

    it('skips non-.md files in commands directory', async () => {
      const globalDir = path.join(tmpHome, '.claude', 'commands');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(path.join(globalDir, 'a.md'), '# A');
      writeFileSync(path.join(globalDir, 'b.txt'), 'not a command');
      writeFileSync(path.join(globalDir, 'c.json'), '{}');

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});

      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/a');
    });

    it('scans plugin commands from installed_plugins.json', async () => {
      const pluginInstallPath = path.join(tmpHome, 'plugins', 'my-plugin');
      const pluginCommandsDir = path.join(pluginInstallPath, 'commands');
      mkdirSync(pluginCommandsDir, { recursive: true });
      writeFileSync(path.join(pluginCommandsDir, 'do-thing.md'), '# Do a thing');

      const manifestDir = path.join(pluginInstallPath, '.claude-plugin');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(
        path.join(manifestDir, 'plugin.json'),
        JSON.stringify({ name: 'my-plugin', description: 'Test plugin', author: { name: 'alice' } }),
      );

      const pluginsRegistryDir = path.join(tmpHome, '.claude', 'plugins');
      mkdirSync(pluginsRegistryDir, { recursive: true });
      writeFileSync(
        path.join(pluginsRegistryDir, 'installed_plugins.json'),
        JSON.stringify({
          version: 1,
          plugins: {
            'my-plugin@market': [
              {
                scope: 'user',
                installPath: pluginInstallPath,
                version: '1.0.0',
                installedAt: 't',
                lastUpdated: 't',
              },
            ],
          },
        }),
      );

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});

      const pluginCmd = result.find(r => r.command === '/my-plugin:do-thing');
      expect(pluginCmd).toBeDefined();
      expect(pluginCmd?.source).toBe('plugin');
      expect(pluginCmd?.description).toContain('Do a thing');
      // Plugin always also publishes /<plugin>:<name> AND the bare /<name>.
      expect(result.map(r => r.command)).toContain('/do-thing');
    });

    it('skips plugin scan when includePlugins is false', async () => {
      const pluginsRegistryDir = path.join(tmpHome, '.claude', 'plugins');
      mkdirSync(pluginsRegistryDir, { recursive: true });
      writeFileSync(
        path.join(pluginsRegistryDir, 'installed_plugins.json'),
        JSON.stringify({ version: 1, plugins: {} }),
      );

      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, { includePlugins: false });

      expect(result).toEqual([]);
    });
  });

  describe('command-scanner — prefix logic (pi-backed)', () => {
    function writeCmd(dir: string, name: string, body: string, frontmatter = '') {
      mkdirSync(dir, { recursive: true });
      const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
      writeFileSync(path.join(dir, `${name}.md`), content);
    }

    it('publishes bare /name only when a single source has it', async () => {
      const userDir = path.join(tmpHome, '.claude', 'commands');
      writeCmd(userDir, 'onlymine', '# Solo command');
      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});
      const names = result.map(r => r.command);
      expect(names).toContain('/onlymine');
      expect(names).not.toContain('/user:onlymine');
    });

    it('publishes /user:, /project:, and bare (project wins) when user+project collide', async () => {
      const userDir = path.join(tmpHome, '.claude', 'commands');
      const projectDir = path.join(tmpProject, '.claude', 'commands');
      writeCmd(userDir, 'shared', '# user-shared');
      writeCmd(projectDir, 'shared', '# project-shared');
      const env = createExecutionEnv(tmpProject);
      const result = await scanCustomCommands(env, { projectRoot: tmpProject });
      const names = result.map(r => r.command).sort();
      expect(names).toEqual(['/project:shared', '/shared', '/user:shared']);
      const bare = result.find(r => r.command === '/shared')!;
      expect(bare.scope).toBe('project');
    });

    it('plugin always also publishes /<plugin>:<name> even without collision', async () => {
      const pluginInstallPath = path.join(tmpHome, 'plugins', 'my-plugin');
      const pluginCommandsDir = path.join(pluginInstallPath, 'commands');
      mkdirSync(pluginCommandsDir, { recursive: true });
      writeFileSync(path.join(pluginCommandsDir, 'pluginonly.md'), '# Plugin only');
      const pluginsRegistryDir = path.join(tmpHome, '.claude', 'plugins');
      mkdirSync(pluginsRegistryDir, { recursive: true });
      writeFileSync(
        path.join(pluginsRegistryDir, 'installed_plugins.json'),
        JSON.stringify({
          version: 1,
          plugins: {
            'my-plugin@market': [
              { scope: 'user', installPath: pluginInstallPath, version: '1.0.0', installedAt: 't', lastUpdated: 't' },
            ],
          },
        }),
      );
      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});
      const names = result.map(r => r.command);
      expect(names).toContain('/pluginonly');
      expect(names).toContain('/my-plugin:pluginonly');
    });

    it('skips excluded plugin doc files (README.md etc)', async () => {
      const pluginInstallPath = path.join(tmpHome, 'plugins', 'doc-plugin');
      const pluginCommandsDir = path.join(pluginInstallPath, 'commands');
      mkdirSync(pluginCommandsDir, { recursive: true });
      writeFileSync(path.join(pluginCommandsDir, 'real.md'), '# Real command');
      writeFileSync(path.join(pluginCommandsDir, 'README.md'), '# Docs not a command');
      const pluginsRegistryDir = path.join(tmpHome, '.claude', 'plugins');
      mkdirSync(pluginsRegistryDir, { recursive: true });
      writeFileSync(
        path.join(pluginsRegistryDir, 'installed_plugins.json'),
        JSON.stringify({
          version: 1,
          plugins: {
            'doc-plugin@market': [
              { scope: 'user', installPath: pluginInstallPath, version: '1.0.0', installedAt: 't', lastUpdated: 't' },
            ],
          },
        }),
      );
      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});
      const names = result.map(r => r.command);
      expect(names).toContain('/real');
      expect(names).toContain('/doc-plugin:real');
      expect(names).not.toContain('/README');
      expect(names).not.toContain('/doc-plugin:README');
    });

    it('dedups intra-plugin double emission when same basename in /commands and root', async () => {
      // discoverPluginCommandInputs adds BOTH <install>/commands and <install>
      // as candidate inputs. If a plugin happens to have the same basename in
      // both, classifyTemplates must not emit /<plugin>:<name> twice.
      const pluginInstallPath = path.join(tmpHome, 'plugins', 'dup-plugin');
      const pluginCommandsDir = path.join(pluginInstallPath, 'commands');
      mkdirSync(pluginCommandsDir, { recursive: true });
      writeFileSync(path.join(pluginCommandsDir, 'foo.md'), '# foo in commands');
      writeFileSync(path.join(pluginInstallPath, 'foo.md'), '# foo at root');
      const pluginsRegistryDir = path.join(tmpHome, '.claude', 'plugins');
      mkdirSync(pluginsRegistryDir, { recursive: true });
      writeFileSync(
        path.join(pluginsRegistryDir, 'installed_plugins.json'),
        JSON.stringify({
          version: 1,
          plugins: {
            'dup-plugin@market': [
              { scope: 'user', installPath: pluginInstallPath, version: '1.0.0', installedAt: 't', lastUpdated: 't' },
            ],
          },
        }),
      );
      const env = createExecutionEnv(tmpHome);
      const result = await scanCustomCommands(env, {});
      const prefixed = result.filter(r => r.command === '/dup-plugin:foo');
      const bare = result.filter(r => r.command === '/foo');
      expect(prefixed).toHaveLength(1);
      expect(bare).toHaveLength(1);
    });
  });
});
