import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeSkillLockHash,
  emptySkillsLock,
  readSkillsLock,
  syncSkillsLock,
  type SkillsLockEntry,
} from '../skills-lock.js';

describe('skills-lock', () => {
  let tmpRoot: string;
  let lockPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-skill-lock-'));
    lockPath = path.join(tmpRoot, '.zclaudia', 'skills-lock.json');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeSkill(name: string, frontmatter = '', body = `# ${name}\n`): string {
    const skillDir = path.join(tmpRoot, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    const filePath = path.join(skillDir, 'SKILL.md');
    const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function seedLock(entries: SkillsLockEntry[]): void {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({ version: 1, skills: Object.fromEntries(entries.map(e => [e.name, e])) }),
      'utf-8'
    );
  }

  describe('computeSkillLockHash', () => {
    it('matches sha256 hex of the utf-8 content', () => {
      const content = '---\nname: x\ndescription: y\n---\n\nbody\n';
      expect(computeSkillLockHash(content)).toBe(
        createHash('sha256').update(content, 'utf8').digest('hex')
      );
    });

    it('differs for different content', () => {
      expect(computeSkillLockHash('a')).not.toBe(computeSkillLockHash('b'));
    });
  });

  describe('readSkillsLock', () => {
    it('returns an empty lock for a missing file', () => {
      expect(readSkillsLock(path.join(tmpRoot, 'absent.json'))).toEqual(emptySkillsLock());
    });

    it('returns an empty lock for a corrupt file', () => {
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, '{not json', 'utf-8');
      expect(readSkillsLock(lockPath)).toEqual(emptySkillsLock());
    });

    it('returns an empty lock when skills is not a record', () => {
      seedLock([]);
      writeFileSync(lockPath, JSON.stringify({ version: 1, skills: [] }), 'utf-8');
      expect(readSkillsLock(lockPath)).toEqual(emptySkillsLock());
    });

    it('drops malformed entries and keeps the record key as name', () => {
      mkdirSync(path.dirname(lockPath), { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 1,
          skills: {
            good: {
              name: 'whatever',
              source: 'owner/repo',
              sourceType: 'github',
              computedHash: 'abc',
              extra: 'ignored',
            },
            bad: { source: 'missing-fields' },
          },
        }),
        'utf-8'
      );
      const lock = readSkillsLock(lockPath);
      expect(Object.keys(lock.skills)).toEqual(['good']);
      expect(lock.skills['good']).toEqual({
        name: 'good',
        source: 'owner/repo',
        sourceType: 'github',
        computedHash: 'abc',
      });
    });
  });

  describe('syncSkillsLock', () => {
    it('creates the lock with provenance defaults and frontmatter overrides', () => {
      const plain = writeSkill('plain');
      const rich = writeSkill(
        'rich',
        'name: rich\nversion: 1.2.0\nsource: owner/repo\nsourceType: github'
      );

      const result = syncSkillsLock({
        lockPath,
        skills: [
          { name: 'plain', filePath: plain },
          { name: 'rich', filePath: rich },
        ],
      });

      expect(result.issues).toEqual([]);
      expect(result.changed).toBe(true);
      const lock = readSkillsLock(lockPath);
      expect(lock.version).toBe(1);
      expect(lock.skills['plain']).toEqual({
        name: 'plain',
        source: path.dirname(plain),
        sourceType: 'external',
        computedHash: computeSkillLockHash(readFileSync(plain, 'utf-8')),
      });
      expect(lock.skills['rich']).toMatchObject({
        name: 'rich',
        source: 'owner/repo',
        sourceType: 'github',
        version: '1.2.0',
      });
    });

    it('is idempotent: no rewrite when nothing changed', () => {
      const filePath = writeSkill('stable');
      syncSkillsLock({ lockPath, skills: [{ name: 'stable', filePath }] });
      const first = readFileSync(lockPath, 'utf-8');

      const second = syncSkillsLock({ lockPath, skills: [{ name: 'stable', filePath }] });

      expect(second.changed).toBe(false);
      expect(second.issues).toEqual([]);
      expect(readFileSync(lockPath, 'utf-8')).toBe(first);
    });

    it('reports hash_mismatch when the recorded hash differs, then refreshes the lock', () => {
      const filePath = writeSkill('vendored', 'name: vendored\ndescription: v1');
      const staleHash = createHash('sha256').update('stale', 'utf8').digest('hex');
      seedLock([
        {
          name: 'vendored',
          source: 'owner/repo',
          sourceType: 'github',
          computedHash: staleHash,
        },
      ]);

      const result = syncSkillsLock({ lockPath, skills: [{ name: 'vendored', filePath }] });

      expect(result.issues).toEqual([
        {
          kind: 'hash_mismatch',
          name: 'vendored',
          path: filePath,
          expectedHash: staleHash,
          actualHash: computeSkillLockHash(readFileSync(filePath, 'utf-8')),
        },
      ]);
      // Lock is refreshed to the current content, so a second pass is clean.
      expect(readSkillsLock(lockPath).skills['vendored'].computedHash).toBe(
        computeSkillLockHash(readFileSync(filePath, 'utf-8'))
      );
      expect(syncSkillsLock({ lockPath, skills: [{ name: 'vendored', filePath }] }).issues).toEqual(
        []
      );
    });

    it('drops entries for skills that are gone and reports unreadable files', () => {
      const filePath = writeSkill('kept');
      seedLock([
        {
          name: 'removed',
          source: 'owner/repo',
          sourceType: 'github',
          computedHash: 'abc',
        },
      ]);

      const result = syncSkillsLock({
        lockPath,
        skills: [
          { name: 'kept', filePath },
          { name: 'vanished', filePath: path.join(tmpRoot, 'skills', 'vanished', 'SKILL.md') },
        ],
      });

      const lock = readSkillsLock(lockPath);
      expect(Object.keys(lock.skills)).toEqual(['kept']);
      expect(result.issues).toEqual([
        {
          kind: 'read_failed',
          name: 'vanished',
          path: path.join(tmpRoot, 'skills', 'vanished', 'SKILL.md'),
        },
      ]);
    });

    it('creates the lock file (including parent dirs) when absent', () => {
      const filePath = writeSkill('fresh');
      expect(existsSync(lockPath)).toBe(false);
      syncSkillsLock({ lockPath, skills: [{ name: 'fresh', filePath }] });
      expect(existsSync(lockPath)).toBe(true);
    });
  });
});
