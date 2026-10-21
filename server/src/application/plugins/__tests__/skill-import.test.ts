import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  defaultGlobalSkillDir,
  EXTERNAL_SKILL_AGENT_SOURCES,
  importExternalSkills,
  recordImportedExternalSkills,
  scanExternalSkillSources,
  symlinkTypeForPlatform,
} from '../skill-import.js';
import { readSkillsLock } from '../skills-lock.js';

describe('skill-import', () => {
  let tmpRoot: string | null = null;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  /** Fixture layout: <root>/home/{.claude,.codex,.cursor}/skills/<skill>/SKILL.md. */
  function makeFixtures(): {
    root: string;
    home: string;
    target: string;
    lockPath: string;
  } {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-skill-import-'));
    const home = path.join(tmpRoot, 'home');
    const target = path.join(home, '.zclaudia', 'skills');
    mkdirSync(target, { recursive: true });
    return {
      root: tmpRoot,
      home,
      target,
      lockPath: path.join(home, '.zclaudia', 'skills-lock.json'),
    };
  }

  function writeSkill(
    agentDir: '.claude' | '.codex' | '.cursor',
    name: string,
    frontmatter: Record<string, string | undefined> = {},
    body = `# ${name}\n`
  ): string {
    const home = path.join(tmpRoot!, 'home');
    const skillDir = path.join(home, agentDir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    const entries = Object.entries(frontmatter).filter(([, v]) => v !== undefined);
    const fm = entries.length
      ? `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n`
      : '';
    const filePath = path.join(skillDir, 'SKILL.md');
    writeFileSync(filePath, `${fm}${body}`, 'utf-8');
    return skillDir;
  }

  describe('symlinkTypeForPlatform', () => {
    it('uses junction on win32 and dir elsewhere', () => {
      expect(symlinkTypeForPlatform('win32')).toBe('junction');
      expect(symlinkTypeForPlatform('darwin')).toBe('dir');
      expect(symlinkTypeForPlatform('linux')).toBe('dir');
    });
  });

  describe('defaultGlobalSkillDir', () => {
    it('resolves ~/.zclaudia/skills from the given home', () => {
      const { home, target } = makeFixtures();
      expect(defaultGlobalSkillDir(home)).toBe(target);
    });

    it('returns null without a home', () => {
      expect(defaultGlobalSkillDir('')).toBeNull();
    });
  });

  describe('scanExternalSkillSources', () => {
    it('covers the three minimal sources (Claude Code, Codex, Cursor)', () => {
      expect(EXTERNAL_SKILL_AGENT_SOURCES.map(s => s.key)).toEqual([
        'claude-code',
        'codex',
        'cursor',
      ]);
      expect(EXTERNAL_SKILL_AGENT_SOURCES.map(s => s.homeRelativeDir)).toEqual([
        '.claude/skills',
        '.codex/skills',
        '.cursor/skills',
      ]);
    });

    it('reports all sources as missing when no external dirs exist', () => {
      const { home } = makeFixtures();
      const scan = scanExternalSkillSources({ homeDir: home });
      expect(scan.sources.map(s => [s.agent, s.status])).toEqual([
        ['claude-code', 'missing'],
        ['codex', 'missing'],
        ['cursor', 'missing'],
      ]);
      expect(scan.importableCount).toBe(0);
    });

    it('lists only directories containing SKILL.md, with frontmatter metadata', () => {
      const { home } = makeFixtures();
      writeSkill('.claude', 'review-helper', {
        name: 'review-helper-skill',
        description: 'Reviews code',
        version: '1.4.2',
      });
      writeSkill('.codex', 'docs-writer', { description: 'Writes docs' });
      // Not a skill: no SKILL.md, plus a stray file.
      mkdirSync(path.join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true });
      writeFileSync(path.join(home, '.claude', 'skills', 'loose.txt'), 'x', 'utf-8');

      const scan = scanExternalSkillSources({ homeDir: home });

      const claude = scan.sources.find(s => s.agent === 'claude-code')!;
      expect(claude.status).toBe('ok');
      expect(claude.skills.map(s => s.name).sort()).toEqual(['review-helper']);
      const review = claude.skills[0];
      expect(review.importable).toBe(true);
      expect(review.skillName).toBe('review-helper-skill');
      expect(review.description).toBe('Reviews code');
      expect(review.version).toBe('1.4.2');
      expect(review.sourceDir).toBe(path.join(home, '.claude', 'skills', 'review-helper'));

      const codex = scan.sources.find(s => s.agent === 'codex')!;
      expect(codex.skills.map(s => s.name)).toEqual(['docs-writer']);
      expect(scan.importableCount).toBe(2);
    });

    it('marks candidates whose target directory already exists as not importable', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'dupe', {});
      mkdirSync(path.join(target, 'dupe'), { recursive: true });

      const scan = scanExternalSkillSources({ homeDir: home });
      const claude = scan.sources.find(s => s.agent === 'claude-code')!;
      expect(claude.skills[0].importable).toBe(false);
      expect(claude.skills[0].skipReason).toBe('target_exists');
      expect(scan.importableCount).toBe(0);
    });

    it('marks candidates colliding with an existing skill frontmatter name', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'fresh-dir', { name: 'taken-name' });
      // Existing global skill declares the same frontmatter name.
      const existingDir = path.join(target, 'existing');
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(
        path.join(existingDir, 'SKILL.md'),
        '---\nname: taken-name\ndescription: x\n---\n\nbody\n',
        'utf-8'
      );

      const scan = scanExternalSkillSources({ homeDir: home });
      const claude = scan.sources.find(s => s.agent === 'claude-code')!;
      expect(claude.skills[0].importable).toBe(false);
      expect(claude.skills[0].skipReason).toBe('name_exists');
    });

    it('marks unreadable SKILL.md candidates as not importable', () => {
      const { home } = makeFixtures();
      const skillDir = writeSkill('.cursor', 'broken', {});
      writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: [unclosed\n---\n', 'utf-8');

      const scan = scanExternalSkillSources({ homeDir: home });
      const cursor = scan.sources.find(s => s.agent === 'cursor')!;
      expect(cursor.skills[0].importable).toBe(false);
      expect(cursor.skills[0].skipReason).toBe('unreadable');
    });
  });

  describe('importExternalSkills', () => {
    it('symlink-imports into the target dir and aggregates per-source counts', () => {
      const { home, target } = makeFixtures();
      const sourceDir = writeSkill('.claude', 'review-helper', {
        description: 'Reviews code',
        version: '2.0.0',
      });
      writeSkill('.codex', 'docs-writer', { description: 'Writes docs' });

      const result = importExternalSkills({
        selections: [
          { agent: 'claude-code', name: 'review-helper' },
          { agent: 'codex', name: 'docs-writer' },
        ],
        mode: 'symlink',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.mode).toBe('symlink');
      expect(result.imported.map(r => r.name).sort()).toEqual(['docs-writer', 'review-helper']);

      const linkPath = path.join(target, 'review-helper');
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(realpathSync(linkPath)).toBe(realpathSync(sourceDir));
      expect(readlinkSync(linkPath)).toBe(sourceDir);
      // Symlink mode never rewrites skill files (no frontmatter injection).
      expect(
        matter(readFileSync(path.join(target, 'docs-writer', 'SKILL.md'), 'utf-8')).data
      ).toEqual({ description: 'Writes docs' });

      expect(result.sources).toEqual([
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          importedCount: 1,
          skippedCount: 0,
          failedCount: 0,
        },
        {
          agent: 'codex',
          agentLabel: 'Codex CLI',
          importedCount: 1,
          skippedCount: 0,
          failedCount: 0,
        },
      ]);
    });

    it('copy-imports the tree and injects source provenance into the copy frontmatter', () => {
      const { home, target } = makeFixtures();
      const sourceDir = writeSkill('.cursor', 'docs-writer', { description: 'Writes docs' });

      const result = importExternalSkills({
        selections: [{ agent: 'cursor', name: 'docs-writer' }],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.outcomes[0].status).toBe('imported');
      const targetDir = path.join(target, 'docs-writer');
      expect(lstatSync(targetDir).isSymbolicLink()).toBe(false);
      expect(statSync(path.join(targetDir, 'SKILL.md')).isFile()).toBe(true);

      // The SOURCE file stays untouched; the COPY declares its origin.
      expect(readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf-8')).not.toContain('source:');
      const copy = matter(readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'));
      expect(copy.data.name).toBeUndefined();
      expect(copy.data.description).toBe('Writes docs');
      expect(copy.data.source).toBe(sourceDir);
      expect(copy.data.sourceType).toBe('cursor');
    });

    it('keeps frontmatter-declared source fields on copies (no overwrite)', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'branded', { source: 'owner/repo', sourceType: 'github' });

      importExternalSkills({
        selections: [{ agent: 'claude-code', name: 'branded' }],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      const copy = matter(readFileSync(path.join(target, 'branded', 'SKILL.md'), 'utf-8'));
      expect(copy.data.source).toBe('owner/repo');
      expect(copy.data.sourceType).toBe('github');
    });

    it('skips same-name targets and name collisions without overwriting', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'dupe', { description: 'external version' });
      const existingDir = path.join(target, 'dupe');
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(
        path.join(existingDir, 'SKILL.md'),
        '---\nname: dupe\ndescription: local version\n---\n\nlocal\n',
        'utf-8'
      );
      const before = readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8');

      const result = importExternalSkills({
        selections: [{ agent: 'claude-code', name: 'dupe' }],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.outcomes).toEqual([
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          name: 'dupe',
          status: 'skipped',
          reason: 'target_exists',
        },
      ]);
      expect(result.sources).toEqual([
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          importedCount: 0,
          skippedCount: 1,
          failedCount: 0,
        },
      ]);
      expect(readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8')).toBe(before);
    });

    it('re-checks frontmatter name collisions at import time (stale scan)', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'inbound', { name: 'clash' });
      const existingDir = path.join(target, 'local');
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(
        path.join(existingDir, 'SKILL.md'),
        '---\nname: clash\ndescription: local\n---\n\nlocal\n',
        'utf-8'
      );

      const result = importExternalSkills({
        selections: [{ agent: 'claude-code', name: 'inbound' }],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'name_exists' });
    });

    it('fails invalid selections without aborting the batch', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'good', {});

      const result = importExternalSkills({
        selections: [
          { agent: 'claude-code', name: '../escape' },
          { agent: 'gemini', name: 'unknown-agent' },
          { agent: 'claude-code', name: 'vanished' },
          { agent: 'claude-code', name: 'good' },
        ],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.outcomes.map(o => [o.name, o.status, o.reason])).toEqual([
        ['../escape', 'failed', 'invalid selection'],
        ['unknown-agent', 'failed', 'invalid selection'],
        ['vanished', 'failed', 'source skill not found'],
        ['good', 'imported', undefined],
      ]);
      expect(existsSync(path.join(target, 'good', 'SKILL.md'))).toBe(true);
      expect(existsSync(path.join(target, '..', 'escape'))).toBe(false);
    });

    it('dedupes repeated selections', () => {
      const { home, target } = makeFixtures();
      writeSkill('.claude', 'once', {});

      const result = importExternalSkills({
        selections: [
          { agent: 'claude-code', name: 'once' },
          { agent: 'claude-code', name: 'once' },
        ],
        mode: 'copy',
        homeDir: home,
        targetSkillDir: target,
      });

      expect(result.outcomes.map(o => [o.status, o.reason])).toEqual([
        ['imported', undefined],
        ['skipped', 'duplicate selection'],
      ]);
    });
  });

  describe('recordImportedExternalSkills', () => {
    it('upserts entries without dropping unrelated lock records and skips no-op writes', () => {
      const { home, target, lockPath } = makeFixtures();
      writeSkill('.claude', 'imported-skill', { version: '3.1.0' });
      importExternalSkills({
        selections: [{ agent: 'claude-code', name: 'imported-skill' }],
        mode: 'symlink',
        homeDir: home,
        targetSkillDir: target,
      });

      // A pre-existing record for another skill must survive the upsert.
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 1,
          skills: {
            other: {
              name: 'other',
              source: 'owner/repo',
              sourceType: 'github',
              computedHash: 'abc',
            },
          },
        }),
        'utf-8'
      );

      const result = recordImportedExternalSkills({
        lockPath,
        imports: [
          {
            agent: 'claude-code',
            agentLabel: 'Claude Code',
            name: 'imported-skill',
            sourceDir: path.join(home, '.claude', 'skills', 'imported-skill'),
            targetPath: path.join(target, 'imported-skill'),
          },
        ],
      });

      expect(result.updated).toBe(true);
      const lock = readSkillsLock(lockPath);
      expect(lock.skills['other']).toMatchObject({ name: 'other', sourceType: 'github' });
      expect(lock.skills['imported-skill']).toMatchObject({
        name: 'imported-skill',
        sourceType: 'claude-code',
        version: '3.1.0',
      });

      // Second run is a no-op: identical entries are not rewritten.
      const before = readFileSync(lockPath, 'utf-8');
      expect(
        recordImportedExternalSkills({
          lockPath,
          imports: [
            {
              agent: 'claude-code',
              agentLabel: 'Claude Code',
              name: 'imported-skill',
              sourceDir: path.join(home, '.claude', 'skills', 'imported-skill'),
              targetPath: path.join(target, 'imported-skill'),
            },
          ],
        })
      ).toEqual({ updated: false });
      expect(readFileSync(lockPath, 'utf-8')).toBe(before);
    });

    it('is a no-op with no imports or no lock path', () => {
      expect(recordImportedExternalSkills({ imports: [] })).toEqual({ updated: false });
      expect(
        recordImportedExternalSkills({
          lockPath: null,
          imports: [
            {
              agent: 'claude-code',
              agentLabel: 'Claude Code',
              name: 'x',
              sourceDir: '/tmp/x',
              targetPath: '/tmp/x',
            },
          ],
        })
      ).toEqual({ updated: false });
    });
  });

  describe('end-to-end with the real home defaults', () => {
    it('scan → import → lock record matches the route flow; rescan shows the skip', () => {
      const { home, target, lockPath } = makeFixtures();
      const sourceDir = writeSkill('.codex', 'e2e-skill', { description: 'End to end' });

      // Simulates the route: scan → import → (refresh) → lock record.
      const scan = scanExternalSkillSources({ homeDir: home, targetSkillDir: target });
      expect(scan.importableCount).toBe(1);
      const result = importExternalSkills({
        selections: [{ agent: 'codex', name: 'e2e-skill' }],
        mode: 'symlink',
        homeDir: home,
        targetSkillDir: target,
      });
      expect(result.imported).toHaveLength(1);
      const record = recordImportedExternalSkills({
        lockPath,
        imports: result.imported,
      });
      expect(record.updated).toBe(true);

      // The lock records the external origin + content hash of the import.
      const lock = readSkillsLock(lockPath);
      expect(lock.skills['e2e-skill']).toEqual({
        name: 'e2e-skill',
        source: sourceDir,
        sourceType: 'codex',
        computedHash: createHash('sha256')
          .update(readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf-8'))
          .digest('hex'),
      });

      // After import the candidate is no longer importable (target exists).
      const rescan = scanExternalSkillSources({ homeDir: home, targetSkillDir: target });
      expect(rescan.importableCount).toBe(0);
      const codex = rescan.sources.find(s => s.agent === 'codex')!;
      expect(codex.skills[0]).toMatchObject({ importable: false, skipReason: 'target_exists' });
    });
  });
});
