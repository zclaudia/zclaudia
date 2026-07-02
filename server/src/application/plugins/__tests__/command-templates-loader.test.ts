import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAllCommandTemplates } from '../command-templates-loader.js';
import { createExecutionEnv } from '../../../infra/execution-env.js';

describe('loadAllCommandTemplates', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-ct-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeCmd(dir: string, name: string, body: string, frontmatter = '') {
    mkdirSync(dir, { recursive: true });
    const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
    writeFileSync(path.join(dir, `${name}.md`), content);
  }

  it('loads templates from a single source dir', async () => {
    const userDir = path.join(tmpRoot, 'user-cmds');
    writeCmd(userDir, 'review', '# Review code\nReview body');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [{ path: userDir, source: 'user' }]);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].source).toBe('user');
    expect(result.templates[0].template.name).toBe('review');
  });

  it('preserves source tags across multiple input dirs', async () => {
    const userDir = path.join(tmpRoot, 'user-cmds');
    const projectDir = path.join(tmpRoot, 'project-cmds');
    writeCmd(userDir, 'a', '# user a');
    writeCmd(projectDir, 'b', '# project b');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [
      { path: userDir, source: 'user' },
      { path: projectDir, source: 'project' },
    ]);
    const sources = result.templates.map(t => t.source).sort();
    expect(sources).toEqual(['project', 'user']);
  });

  it('skips missing input dir without throwing', async () => {
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [
      { path: path.join(tmpRoot, 'no-such-dir'), source: 'user' },
    ]);
    expect(result.templates).toEqual([]);
  });

  it('overrides description from frontmatter when present', async () => {
    const userDir = path.join(tmpRoot, 'user-cmds');
    writeCmd(userDir, 'fm', '# fm body', 'description: My custom desc');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [{ path: userDir, source: 'user' }]);
    expect(result.templates[0].template.description).toBe('My custom desc');
  });

  it('attaches plugin provenance when source is plugin', async () => {
    const pluginDir = path.join(tmpRoot, 'plugin-x-cmds');
    writeCmd(pluginDir, 'special', '# plugin special');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [
      { path: pluginDir, source: 'plugin', plugin: { pluginName: 'plugin-x' } },
    ]);
    expect(result.templates[0].plugin?.pluginName).toBe('plugin-x');
  });

  it('attributes templates correctly when multiple plugin inputs share a basename', async () => {
    const pluginADir = path.join(tmpRoot, 'plugin-a-cmds');
    const pluginBDir = path.join(tmpRoot, 'plugin-b-cmds');
    writeCmd(pluginADir, 'foo', '# A foo');
    writeCmd(pluginBDir, 'foo', '# B foo');
    const env = createExecutionEnv(tmpRoot);
    const result = await loadAllCommandTemplates(env, [
      { path: pluginADir, source: 'plugin', plugin: { pluginName: 'plugin-a' } },
      { path: pluginBDir, source: 'plugin', plugin: { pluginName: 'plugin-b' } },
    ]);
    expect(result.templates).toHaveLength(2);

    const pluginNames = result.templates.map(t => t.plugin?.pluginName).sort();
    expect(pluginNames).toEqual(['plugin-a', 'plugin-b']);

    // Each template's filePath points at its own plugin dir
    const a = result.templates.find(t => t.plugin?.pluginName === 'plugin-a')!;
    const b = result.templates.find(t => t.plugin?.pluginName === 'plugin-b')!;
    expect(a.filePath).toBe(path.join(pluginADir, 'foo.md'));
    expect(b.filePath).toBe(path.join(pluginBDir, 'foo.md'));
  });
});
