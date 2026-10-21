import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { computeSkillLockHash, readSkillsLock } from '../skills-lock.js';

/**
 * Integrity tests for the shipped content plugins under plugins/skills/
 * (ledger item 38: direct distribution of official skill content).
 *
 * The distributed SKILL.md files are third-party content locked in
 * plugins/skills/skills-lock.json using the SkillsLockFile format — these
 * tests pin the lock to the content and pin the content to the manifests, so
 * an unregistered edit or a stale hash fails here instead of drifting silently.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const skillsPluginsRoot = path.join(repoRoot, 'plugins', 'skills');

const CONTENT_PLUGINS = readdirSync(skillsPluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => existsSync(path.join(skillsPluginsRoot, name, 'plugin.json')))
  .sort();

interface DiscoveredSkill {
  plugin: string;
  name: string;
  filePath: string;
}

function discoverDistributedSkills(): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  for (const plugin of CONTENT_PLUGINS) {
    const manifest = JSON.parse(
      readFileSync(path.join(skillsPluginsRoot, plugin, 'plugin.json'), 'utf-8')
    ) as { contributes?: { skills?: Array<{ path: string }> } };
    for (const skill of manifest.contributes?.skills ?? []) {
      const filePath = path.join(skillsPluginsRoot, plugin, skill.path);
      skills.push({ plugin, name: path.basename(path.dirname(filePath)), filePath });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

describe('distributed skills plugins (plugins/skills)', () => {
  it('ships the two expected content plugins', () => {
    expect(CONTENT_PLUGINS).toEqual(expect.arrayContaining(['superpowers', 'zcode-guide']));
  });

  describe('plugin manifests', () => {
    for (const plugin of CONTENT_PLUGINS) {
      it(`${plugin}/plugin.json is a valid content-only manifest`, () => {
        const pluginDir = path.join(skillsPluginsRoot, plugin);
        const raw = JSON.parse(
          readFileSync(path.join(pluginDir, 'plugin.json'), 'utf-8')
        ) as Record<string, unknown>;

        expect(typeof raw.id).toBe('string');
        expect(raw.id).toMatch(/^com\.zclaudia\.skills\.[a-z0-9-]+$/);
        expect(typeof raw.name).toBe('string');
        expect(typeof raw.version).toBe('string');
        expect(typeof raw.description).toBe('string');
        // Content-only: no backend module, universal platform, active at startup.
        expect(raw.main).toBeUndefined();
        expect(raw.platform).toBe('universal');
        expect(raw.activationEvents).toContain('onStartup');

        const skills = (raw.contributes as { skills?: Array<{ path: string }> }).skills ?? [];
        expect(skills.length).toBeGreaterThan(0);
        const resolvedPluginDir = path.resolve(pluginDir);
        for (const skill of skills) {
          const skillMdPath = path.resolve(pluginDir, skill.path);
          // Mirror the loader's traversal guard: paths must stay inside the plugin.
          expect(
            skillMdPath.startsWith(resolvedPluginDir + path.sep) ||
              skillMdPath === resolvedPluginDir
          ).toBe(true);
          expect(statSync(skillMdPath).isFile()).toBe(true);
        }
      });
    }
  });

  describe('SKILL.md frontmatter (pi loader rules + lock provenance)', () => {
    const skills = discoverDistributedSkills();

    it('declares every distributed skill in a manifest (no orphan skill dirs)', () => {
      for (const plugin of CONTENT_PLUGINS) {
        const skillDirs = readdirSync(path.join(skillsPluginsRoot, plugin, 'skills')).sort();
        const declared = skills
          .filter(s => s.plugin === plugin)
          .map(s => s.name)
          .sort();
        expect(skillDirs).toEqual(declared);
      }
    });

    for (const skill of skills) {
      it(`${skill.name}/SKILL.md satisfies pi frontmatter validation`, () => {
        const raw = readFileSync(skill.filePath, 'utf-8');
        const data = (matter(raw).data ?? {}) as Record<string, unknown>;

        // pi: name defaults to the directory; a present name must match it.
        expect(data.name).toBe(skill.name);
        expect(skill.name).toMatch(/^[a-z0-9-]+$/);
        expect(skill.name.length).toBeLessThanOrEqual(64);

        // pi: description required, <= 1024 chars, else the skill is dropped.
        expect(typeof data.description).toBe('string');
        expect((data.description as string).trim().length).toBeGreaterThan(0);
        expect((data.description as string).length).toBeLessThanOrEqual(1024);

        // Lock provenance fields consumed by skills-lock.extractLockProvenance.
        expect(typeof data.source).toBe('string');
        expect(typeof data.sourceType).toBe('string');
        expect(typeof data.version).toBe('string');
        expect(typeof data.license).toBe('string');
      });
    }

    it('superpowers skills carry MIT provenance, zcode-guide skills Apache-2.0/zcode', () => {
      for (const skill of skills) {
        const data = (matter(readFileSync(skill.filePath, 'utf-8')).data ?? {}) as Record<
          string,
          unknown
        >;
        if (skill.plugin === 'superpowers') {
          expect(data.license).toBe('MIT');
          expect(data.source).toBe('obra/superpowers');
          expect(data.sourceType).toBe('github');
          expect(data.version).toBe('5.1.0');
        } else {
          expect(data.license).toBe('Apache-2.0');
          expect(String(data.source)).toContain('zcode-guide-plugin');
          expect(data.sourceType).toBe('zcode');
          expect(data.version).toBe('0.3.0');
        }
      }
    });
  });

  describe('skills-lock.json (SkillsLockFile format)', () => {
    const skills = discoverDistributedSkills();
    const lockPath = path.join(skillsPluginsRoot, 'skills-lock.json');
    const lock = readSkillsLock(lockPath);

    it('round-trips through readSkillsLock without dropped entries', () => {
      const raw = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
        skills: Record<string, unknown>;
      };
      expect(lock.version).toBe(1);
      expect(Object.keys(lock.skills).sort()).toEqual(Object.keys(raw.skills).sort());
    });

    it('registers exactly the distributed skills', () => {
      expect(Object.keys(lock.skills).sort()).toEqual(skills.map(s => s.name).sort());
    });

    for (const skill of skills) {
      it(`${skill.name} hash + provenance match the shipped content`, () => {
        const entry = lock.skills[skill.name];
        expect(entry).toBeDefined();
        const raw = readFileSync(skill.filePath, 'utf-8');
        // The lock must be FRESH: recomputing the hash over the current
        // SKILL.md reproduces the recorded computedHash.
        expect(entry.computedHash).toBe(computeSkillLockHash(raw));
        const data = (matter(raw).data ?? {}) as Record<string, unknown>;
        expect(entry.source).toBe(data.source);
        expect(entry.sourceType).toBe(data.sourceType);
        expect(entry.version).toBe(data.version);
      });
    }

    it('superpowers upstream LICENSE text ships with the plugin', () => {
      const license = readFileSync(path.join(skillsPluginsRoot, 'superpowers', 'LICENSE'), 'utf-8');
      expect(license).toContain('MIT License');
      expect(license).toContain('Copyright (c) 2025 Jesse Vincent');
    });
  });
});
