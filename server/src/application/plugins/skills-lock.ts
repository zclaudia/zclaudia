/**
 * Skills lock: provenance + integrity records for third-party (external)
 * skills.
 *
 * The record shape adopts the `skills-lock.json` format used by ZCode
 * (`source` / `sourceType` / `computedHash`, keyed by skill name); ZCode
 * itself ships no generating or consuming code for it, so this module is an
 * original minimal implementation built on zclaudia's own skill loading
 * flow (skill-tools.loadAndCacheSkills):
 *
 *   - External skills (well-known + user-configured dirs) are hashed
 *     (sha256 of the raw SKILL.md content) and recorded on every load pass,
 *     which is where installs and changes become visible to the app.
 *   - The recorded hash is compared with the current file BEFORE the lock is
 *     refreshed, so drift between two loads (upstream update or local
 *     tampering) surfaces as a warning diagnostic instead of silently
 *     passing. Workspace and plugin-bundled skills never enter the lock.
 *   - The lock is best-effort state, not a gate: a missing, corrupt or
 *     unwritable lock file must never break skill loading.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface SkillsLockEntry {
  /** Skill id (containing directory name, mirroring skill-tools.skillId). */
  name: string;
  /** Provenance: frontmatter `source` when declared, else the skill directory. */
  source: string;
  /** Provenance kind: frontmatter `sourceType` when declared, else 'external'. */
  sourceType: string;
  /** sha256 (hex) of the skill's SKILL.md content at lock time. */
  computedHash: string;
  /** Upstream version from frontmatter `version`, when declared. */
  version?: string;
}

export interface SkillsLockFile {
  version: 1;
  skills: Record<string, SkillsLockEntry>;
}

export type SkillLockIssueKind = 'hash_mismatch' | 'read_failed';

export interface SkillLockIssue {
  kind: SkillLockIssueKind;
  name: string;
  /** SKILL.md path the issue relates to. */
  path: string;
  /** Recorded hash (hash_mismatch only). */
  expectedHash?: string;
  /** Current hash (hash_mismatch only). */
  actualHash?: string;
}

export interface SkillLockInput {
  name: string;
  filePath: string;
}

export interface SkillsLockSyncOptions {
  lockPath: string;
  /** Third-party skills to record, in the order they were discovered. */
  skills: SkillLockInput[];
}

export interface SkillsLockSyncResult {
  /** True when the lock content changed and the file was rewritten. */
  changed: boolean;
  issues: SkillLockIssue[];
}

export function computeSkillLockHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function emptySkillsLock(): SkillsLockFile {
  return { version: 1, skills: {} };
}

function normalizeLockEntry(value: unknown): SkillsLockEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.name !== 'string' ||
    typeof row.source !== 'string' ||
    typeof row.sourceType !== 'string' ||
    typeof row.computedHash !== 'string'
  ) {
    return undefined;
  }
  return {
    name: row.name,
    source: row.source,
    sourceType: row.sourceType,
    computedHash: row.computedHash,
    ...(typeof row.version === 'string' ? { version: row.version } : {}),
  };
}

/**
 * Read and normalize the lock file. Missing or corrupt files normalize to an
 * empty lock so a damaged lock never blocks skill loading.
 */
export function readSkillsLock(lockPath: string): SkillsLockFile {
  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf-8');
  } catch {
    return emptySkillsLock();
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !parsed.skills ||
      typeof parsed.skills !== 'object' ||
      Array.isArray(parsed.skills)
    ) {
      return emptySkillsLock();
    }
    const skills: Record<string, SkillsLockEntry> = {};
    for (const [name, entry] of Object.entries(parsed.skills as Record<string, unknown>)) {
      const normalized = normalizeLockEntry(entry);
      if (normalized) skills[name] = { ...normalized, name };
    }
    return { version: 1, skills };
  } catch {
    return emptySkillsLock();
  }
}

export function writeSkillsLock(lockPath: string, lock: SkillsLockFile): void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8');
}

interface LockProvenance {
  version?: string;
  source?: string;
  sourceType?: string;
}

function extractLockProvenance(raw: string): LockProvenance {
  try {
    const data = (matter(raw).data ?? {}) as Record<string, unknown>;
    const str = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;
    return {
      version: str(data.version),
      source: str(data.source),
      sourceType: str(data.sourceType),
    };
  } catch {
    return {};
  }
}

/**
 * Validate the discovered third-party skills against the lock file, then
 * refresh the lock to the current state:
 *
 *   1. Read the existing lock (tolerant of missing/corrupt files).
 *   2. Hash each skill's SKILL.md; when a recorded entry differs, collect a
 *      `hash_mismatch` issue (upstream update or local tampering since the
 *      previous load).
 *   3. Rebuild the lock from the current skills only — entries for skills
 *      that disappeared are dropped.
 *   4. Rewrite the file when the content changed.
 *
 * Skills that cannot be read are reported as `read_failed` and left out of
 * the refreshed lock.
 */
export function syncSkillsLock(options: SkillsLockSyncOptions): SkillsLockSyncResult {
  const existing = readSkillsLock(options.lockPath);
  const issues: SkillLockIssue[] = [];
  const next = emptySkillsLock();

  for (const { name, filePath } of [...options.skills].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      issues.push({ kind: 'read_failed', name, path: filePath });
      continue;
    }
    const computedHash = computeSkillLockHash(raw);
    const recorded = existing.skills[name];
    if (recorded && recorded.computedHash !== computedHash) {
      issues.push({
        kind: 'hash_mismatch',
        name,
        path: filePath,
        expectedHash: recorded.computedHash,
        actualHash: computedHash,
      });
    }
    const provenance = extractLockProvenance(raw);
    const entry: SkillsLockEntry = {
      name,
      source: provenance.source ?? path.dirname(filePath),
      sourceType: provenance.sourceType ?? 'external',
      computedHash,
      ...(provenance.version ? { version: provenance.version } : {}),
    };
    next.skills[name] = entry;
  }

  const changed = JSON.stringify(next) !== JSON.stringify(existing);
  if (changed) {
    writeSkillsLock(options.lockPath, next);
  }
  return { changed, issues };
}
