import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSkillFile, discoverSkillsInDir, loadSkillContent } from '../skill-tools.js';
import { createExecutionEnv } from '../../../infra/execution-env.js';

describe('plugins/skill-tools', () => {
  describe('parseSkillFile', () => {
    it('parses frontmatter with CRLF newlines and typed nested fields', () => {
      const content = [
        '---',
        'name: review-helper',
        'description: Review pull requests',
        'priority: -1',
        'triggers:',
        '  keywords:',
        '    - review',
        '    - pr',
        '  projectType:',
        '    - code',
        'requires:',
        '  binaries:',
        '    - git',
        '  env:',
        '    - GITHUB_TOKEN',
        'metadata:',
        '  short-description: ignored',
        '---',
        '',
        '# Review Helper',
        '',
        '> Uses review workflow',
      ].join('\r\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter).toEqual({
        name: 'review-helper',
        description: 'Review pull requests',
        priority: -1,
        triggers: {
          keywords: ['review', 'pr'],
          projectType: ['code'],
        },
        requires: {
          binaries: ['git'],
          env: ['GITHUB_TOKEN'],
        },
      });
      expect(parsed.body).toContain('# Review Helper');
      expect(parsed.body).toContain('> Uses review workflow');
    });

    it('does not confuse body separators with frontmatter boundaries', () => {
      const content = [
        '---',
        'name: separator-safe',
        'description: Keeps body separators intact',
        '---',
        '',
        '# Heading',
        '',
        '---',
        '',
        'Body content',
      ].join('\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter.name).toBe('separator-safe');
      expect(parsed.body).toContain('\n---\n');
      expect(parsed.body).toContain('Body content');
    });

    it('falls back gracefully when frontmatter YAML is invalid', () => {
      const content = [
        '---',
        'name: [oops',
        'description: broken yaml',
        '---',
        '',
        '# Fallback Name',
      ].join('\n');

      const parsed = parseSkillFile(content);

      expect(parsed.frontmatter).toEqual({});
      expect(parsed.body).toBe(content);
    });
  });
});

describe('plugins/skill-tools — fs-backed', () => {
  let tmpRoot: string;
  beforeEach(() => { tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-skill-')); });
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  describe('discoverSkillsInDir', () => {
    it('returns [] when dir does not exist', async () => {
      const env = createExecutionEnv(tmpRoot);
      const result = await discoverSkillsInDir(env, path.join(tmpRoot, 'missing'), 'workspace');
      expect(result).toEqual([]);
    });

    it('discovers a top-level skill with SKILL.md', async () => {
      const skillDir = path.join(tmpRoot, 'my-skill');
      mkdirSync(skillDir);
      writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: A skill\n---\n\n# My Skill\n');
      const env = createExecutionEnv(tmpRoot);
      const result = await discoverSkillsInDir(env, tmpRoot, 'workspace');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'my-skill',
        name: 'my-skill',
        description: 'A skill',
        source: 'workspace',
      });
    });

    it('recurses into subdirectories without SKILL.md', async () => {
      const nestedDir = path.join(tmpRoot, 'group', 'nested-skill');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'SKILL.md'), '---\nname: nested\ndescription: nested skill\n---\n');
      const env = createExecutionEnv(tmpRoot);
      const result = await discoverSkillsInDir(env, tmpRoot, 'external');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('nested-skill');
    });

    it('respects MAX_RECURSION_DEPTH', async () => {
      let dir = tmpRoot;
      for (let i = 0; i < 6; i++) {
        dir = path.join(dir, `level${i}`);
        mkdirSync(dir);
      }
      writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: deep\ndescription: too deep\n---\n');
      const env = createExecutionEnv(tmpRoot);
      const result = await discoverSkillsInDir(env, tmpRoot, 'workspace');
      expect(result).toHaveLength(0);
    });
  });

  describe('loadSkillContent', () => {
    it('returns SKILL.md content for an existing skill', async () => {
      const skillDir = path.join(tmpRoot, 's');
      mkdirSync(skillDir);
      writeFileSync(path.join(skillDir, 'SKILL.md'), 'hello world');
      const env = createExecutionEnv(tmpRoot);
      const content = await loadSkillContent(env, skillDir);
      expect(content).toBe('hello world');
    });

    it('appends references/*.md when references dir exists', async () => {
      const skillDir = path.join(tmpRoot, 's');
      const refsDir = path.join(skillDir, 'references');
      mkdirSync(refsDir, { recursive: true });
      writeFileSync(path.join(skillDir, 'SKILL.md'), 'main');
      writeFileSync(path.join(refsDir, 'a.md'), 'ref-a');
      const env = createExecutionEnv(tmpRoot);
      const content = await loadSkillContent(env, skillDir);
      expect(content).toContain('main');
      expect(content).toContain('## Reference: a.md');
      expect(content).toContain('ref-a');
    });

    it('returns sentinel string when SKILL.md missing', async () => {
      const env = createExecutionEnv(tmpRoot);
      const content = await loadSkillContent(env, path.join(tmpRoot, 'nope'));
      expect(content).toContain('Skill file not found');
    });
  });
});
