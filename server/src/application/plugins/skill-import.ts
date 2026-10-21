/**
 * External agent skills import: scan third-party agent CLI skill directories
 * (Claude Code / Codex / Cursor) and materialize selected skills into
 * zclaudia's global skill directory.
 *
 * Semantics follow the external-agent skills import design of ZCode
 * (Apache-2.0, docs/external-agent-skills-import.md): only directories that
 * contain a SKILL.md are candidates, import materializes a symlink (junction
 * on Windows) or a full copy, an existing target directory or an existing
 * skill with the same `name` is skipped (never overwritten), and results are
 * aggregated per source as imported/skipped/failed counts. The implementation
 * is original and builds on zclaudia's own conventions: the global skills dir
 * (~/.zclaudia/skills, cf. skill-tools.getWellKnownSkillDirs) and the
 * skills-lock file (skills-lock.ts), whose entries are UPSERTED here — never
 * rebuilt — so an import can never drop records for other skills.
 *
 * Provenance durability: the lock prefers frontmatter `source`/`sourceType`
 * (skills-lock.ts contract). Copy imports therefore inject those frontmatter
 * fields into the imported copy (only when not already declared), so the
 * external origin survives the lock refresh that every skill load performs.
 * Symlink imports point at files owned by the other agent and must not be
 * rewritten, so their origin is recorded by upserting the lock after the
 * post-import refresh; a later lock refresh normalizes those entries back to
 * the local defaults by design.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  computeSkillLockHash,
  readSkillsLock,
  writeSkillsLock,
  type SkillsLockEntry,
} from './skills-lock.js';

export type ExternalSkillAgentKey = 'claude-code' | 'codex' | 'cursor';

export interface ExternalSkillAgentSource {
  key: ExternalSkillAgentKey;
  label: string;
  /** Skills directory relative to the user's home. */
  homeRelativeDir: string;
}

/**
 * Minimal source set (see the ZCode spec for the full 16-source list; the
 * registry shape makes additional sources a one-line addition).
 */
export const EXTERNAL_SKILL_AGENT_SOURCES: readonly ExternalSkillAgentSource[] = [
  { key: 'claude-code', label: 'Claude Code', homeRelativeDir: '.claude/skills' },
  { key: 'codex', label: 'Codex CLI', homeRelativeDir: '.codex/skills' },
  { key: 'cursor', label: 'Cursor', homeRelativeDir: '.cursor/skills' },
];

export type ExternalSkillImportMode = 'symlink' | 'copy';

export type ExternalSkillSkipReason = 'target_exists' | 'name_exists' | 'unreadable';

export interface ExternalSkillCandidate {
  agent: ExternalSkillAgentKey;
  agentLabel: string;
  /** Skill directory basename in the external source (becomes the skill id). */
  name: string;
  /** Frontmatter `name`, when declared. */
  skillName?: string;
  description?: string;
  /** Frontmatter `version`, when declared. */
  version?: string;
  sourceDir: string;
  skillMdPath: string;
  importable: boolean;
  /** Why the candidate is filtered out of the importable list. */
  skipReason?: ExternalSkillSkipReason;
}

export interface ExternalSkillSourceScan {
  agent: ExternalSkillAgentKey;
  agentLabel: string;
  /** Absolute scanned directory; empty when no home directory resolves. */
  path: string;
  status: 'ok' | 'missing';
  skills: ExternalSkillCandidate[];
}

export interface ExternalSkillScanResult {
  sources: ExternalSkillSourceScan[];
  importableCount: number;
}

export interface ExternalSkillSelection {
  agent: ExternalSkillAgentKey;
  /** Skill directory basename as reported by scanExternalSkillSources. */
  name: string;
}

export interface ExternalSkillImportOptions {
  selections: ExternalSkillSelection[];
  /** Default 'symlink'. */
  mode?: ExternalSkillImportMode;
  /** Override the home directory (tests). Defaults to $HOME / $USERPROFILE. */
  homeDir?: string;
  /** Override the import target (tests). Defaults to ~/.zclaudia/skills. */
  targetSkillDir?: string;
}

export interface ExternalSkillImportRecord {
  agent: ExternalSkillAgentKey;
  agentLabel: string;
  name: string;
  sourceDir: string;
  targetPath: string;
}

export interface ExternalSkillImportOutcome {
  /** Registry key; an arbitrary string only for malformed selections. */
  agent: string;
  agentLabel: string;
  name: string;
  status: 'imported' | 'skipped' | 'failed';
  reason?: string;
  targetPath?: string;
}

export interface ExternalSkillSourceCounts {
  agent: string;
  agentLabel: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface ExternalSkillImportResult {
  mode: ExternalSkillImportMode;
  targetSkillDir: string | null;
  outcomes: ExternalSkillImportOutcome[];
  sources: ExternalSkillSourceCounts[];
  imported: ExternalSkillImportRecord[];
}

export interface RecordImportedSkillsOptions {
  imports: ExternalSkillImportRecord[];
  /** Defaults to ~/.zclaudia/skills-lock.json (null disables the write). */
  lockPath?: string | null;
}

export interface RecordImportedSkillsResult {
  /** True when any lock entry was added or changed and the file rewritten. */
  updated: boolean;
}

function resolveHomeDir(homeDir?: string): string | null {
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? home : null;
}

export function defaultGlobalSkillDir(homeDir?: string): string | null {
  const home = resolveHomeDir(homeDir);
  return home ? path.join(home, '.zclaudia', 'skills') : null;
}

function defaultLockPath(homeDir?: string): string | null {
  const home = resolveHomeDir(homeDir);
  return home ? path.join(home, '.zclaudia', 'skills-lock.json') : null;
}

/** Directory symlink type: junctions need no elevation on Windows. */
export function symlinkTypeForPlatform(
  platform: NodeJS.Platform = process.platform
): 'dir' | 'junction' {
  return platform === 'win32' ? 'junction' : 'dir';
}

/** Skill ids are single path segments (mirrors the routes' traversal guards). */
function isSafeSegment(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    name === path.basename(name) &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

interface SkillFrontmatterInfo {
  name?: string;
  version?: string;
  description?: string;
  source?: string;
  sourceType?: string;
}

/** Null when the file cannot be read or its frontmatter does not parse. */
function readSkillFrontmatter(skillMdPath: string): SkillFrontmatterInfo | null {
  let raw: string;
  try {
    raw = readFileSync(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const data = (matter(raw).data ?? {}) as Record<string, unknown>;
    const str = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;
    return {
      name: str(data.name),
      version: str(data.version),
      description: str(data.description),
      source: str(data.source),
      sourceType: str(data.sourceType),
    };
  } catch {
    return null;
  }
}

interface ExistingTargetNames {
  dirNames: Set<string>;
  frontmatterNames: Set<string>;
}

function collectExistingTargetNames(targetDir: string): ExistingTargetNames {
  const names: ExistingTargetNames = { dirNames: new Set(), frontmatterNames: new Set() };
  let entries: Dirent[];
  try {
    entries = readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillMdPath = path.join(targetDir, entry.name, 'SKILL.md');
    if (!isFile(skillMdPath)) continue;
    names.dirNames.add(entry.name);
    const info = readSkillFrontmatter(skillMdPath);
    if (info?.name) names.frontmatterNames.add(info.name);
  }
  return names;
}

function skipReasonFor(
  name: string,
  info: SkillFrontmatterInfo,
  targetDir: string,
  existing: ExistingTargetNames
): ExternalSkillSkipReason | undefined {
  if (existsSync(path.join(targetDir, name))) return 'target_exists';
  if (info.name && (existing.frontmatterNames.has(info.name) || existing.dirNames.has(info.name))) {
    return 'name_exists';
  }
  return undefined;
}

/**
 * Enumerate the well-known external agent skill sources and their SKILL.md
 * skills. Missing/unreadable source directories report status 'missing'
 * instead of failing — an uninstalled agent is the normal case. Candidates
 * that would collide with an existing global skill are listed with
 * importable: false so the UI can filter them out.
 */
export function scanExternalSkillSources(
  options: { homeDir?: string; targetSkillDir?: string } = {}
): ExternalSkillScanResult {
  const home = resolveHomeDir(options.homeDir);
  const targetDir = options.targetSkillDir ?? defaultGlobalSkillDir(home ?? undefined);
  const existing: ExistingTargetNames = targetDir
    ? collectExistingTargetNames(targetDir)
    : { dirNames: new Set(), frontmatterNames: new Set() };

  let importableCount = 0;
  const sources: ExternalSkillSourceScan[] = EXTERNAL_SKILL_AGENT_SOURCES.map(source => {
    const base = { agent: source.key, agentLabel: source.label };
    const sourceDir = home ? path.join(home, source.homeRelativeDir) : null;
    if (!sourceDir) return { ...base, path: '', status: 'missing' as const, skills: [] };

    let entries: Dirent[];
    try {
      entries = readdirSync(sourceDir, { withFileTypes: true });
    } catch {
      return { ...base, path: sourceDir, status: 'missing' as const, skills: [] };
    }

    const skills = entries
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(entry => {
        const skillDir = path.join(sourceDir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (!isFile(skillMdPath)) return [];
        const info = readSkillFrontmatter(skillMdPath);
        if (!info) {
          return [
            {
              ...base,
              name: entry.name,
              sourceDir: skillDir,
              skillMdPath,
              importable: false,
              skipReason: 'unreadable' as const,
            },
          ];
        }
        const skipReason = targetDir
          ? skipReasonFor(entry.name, info, targetDir, existing)
          : undefined;
        return [
          {
            ...base,
            name: entry.name,
            ...(info.name ? { skillName: info.name } : {}),
            ...(info.description ? { description: info.description } : {}),
            ...(info.version ? { version: info.version } : {}),
            sourceDir: skillDir,
            skillMdPath,
            importable: !skipReason,
            ...(skipReason ? { skipReason } : {}),
          },
        ];
      });

    for (const skill of skills) if (skill.importable) importableCount += 1;
    return { ...base, path: sourceDir, status: 'ok' as const, skills };
  });

  return { sources, importableCount };
}

/**
 * Materialize the selected skills into the target directory. Per-selection
 * failures (unknown agent, unsafe name, vanished source) become `failed`
 * outcomes instead of aborting the batch; collisions are re-checked against
 * the live target directory because the scan result may be stale.
 */
export function importExternalSkills(
  options: ExternalSkillImportOptions
): ExternalSkillImportResult {
  const mode = options.mode ?? 'symlink';
  const home = resolveHomeDir(options.homeDir);
  const targetDir = options.targetSkillDir ?? defaultGlobalSkillDir(home ?? undefined);

  const outcomes: ExternalSkillImportOutcome[] = [];
  const imported: ExternalSkillImportRecord[] = [];
  let targetDirCreated = false;

  const isSelection = (value: unknown): value is ExternalSkillSelection =>
    !!value &&
    typeof value === 'object' &&
    typeof (value as ExternalSkillSelection).agent === 'string' &&
    typeof (value as ExternalSkillSelection).name === 'string';

  // Dedupe repeated selections; re-selecting the same skill twice must not
  // race itself (the second pass would see the target and report skipped).
  const seen = new Set<string>();
  for (const selection of options.selections) {
    const source = isSelection(selection)
      ? EXTERNAL_SKILL_AGENT_SOURCES.find(s => s.key === selection.agent)
      : undefined;
    const outcomeBase = {
      agent: isSelection(selection) ? selection.agent : '',
      agentLabel: source?.label ?? '',
      name: isSelection(selection) ? selection.name : '',
    };
    if (!source || !isSafeSegment(selection.name)) {
      outcomes.push({ ...outcomeBase, status: 'failed', reason: 'invalid selection' });
      continue;
    }
    const dedupeKey = `${selection.agent}:${selection.name}`;
    if (seen.has(dedupeKey)) {
      outcomes.push({ ...outcomeBase, status: 'skipped', reason: 'duplicate selection' });
      continue;
    }
    seen.add(dedupeKey);

    if (!home || !targetDir) {
      outcomes.push({ ...outcomeBase, status: 'failed', reason: 'no home directory' });
      continue;
    }

    const sourceDir = path.join(home, source.homeRelativeDir, selection.name);
    const sourceSkillMd = path.join(sourceDir, 'SKILL.md');
    if (!isFile(sourceSkillMd)) {
      outcomes.push({ ...outcomeBase, status: 'failed', reason: 'source skill not found' });
      continue;
    }

    const targetPath = path.join(targetDir, selection.name);
    if (existsSync(targetPath)) {
      outcomes.push({ ...outcomeBase, status: 'skipped', reason: 'target_exists' });
      continue;
    }

    const existing = collectExistingTargetNames(targetDir);
    const info = readSkillFrontmatter(sourceSkillMd);
    if (!info) {
      outcomes.push({ ...outcomeBase, status: 'failed', reason: 'unreadable SKILL.md' });
      continue;
    }
    const nameConflict = skipReasonFor(selection.name, info, targetDir, existing);
    if (nameConflict) {
      outcomes.push({ ...outcomeBase, status: 'skipped', reason: nameConflict });
      continue;
    }

    try {
      if (!targetDirCreated) {
        mkdirSync(targetDir, { recursive: true });
        targetDirCreated = true;
      }
      if (mode === 'symlink') {
        symlinkSync(sourceDir, targetPath, symlinkTypeForPlatform());
      } else {
        cpSync(sourceDir, targetPath, { recursive: true });
        injectCopyProvenance(path.join(targetPath, 'SKILL.md'), info, sourceDir, source.key);
      }
    } catch (error) {
      outcomes.push({
        ...outcomeBase,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    outcomes.push({ ...outcomeBase, status: 'imported', targetPath });
    imported.push({
      agent: source.key,
      agentLabel: source.label,
      name: selection.name,
      sourceDir,
      targetPath,
    });
  }

  return {
    mode,
    targetSkillDir: targetDir,
    outcomes,
    sources: aggregateSourceCounts(outcomes),
    imported,
  };
}

/**
 * Copy-mode provenance: declare `source`/`sourceType` in the imported copy's
 * frontmatter (only when not already declared) so skills-lock's frontmatter
 * precedence keeps the external origin across lock refreshes. Symlink imports
 * must NOT rewrite files owned by the external agent.
 */
function injectCopyProvenance(
  targetSkillMd: string,
  info: SkillFrontmatterInfo,
  sourceDir: string,
  agentKey: ExternalSkillAgentKey
): void {
  if (info.source && info.sourceType) return;
  try {
    const raw = readFileSync(targetSkillMd, 'utf-8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    if (!info.source && !data.source) data.source = sourceDir;
    if (!info.sourceType && !data.sourceType) data.sourceType = agentKey;
    writeFileSync(targetSkillMd, matter.stringify(parsed.content, data), 'utf-8');
  } catch (error) {
    // Provenance is best-effort: the copy itself already succeeded, and the
    // lock upsert falls back to the import origin for undeclared fields.
    console.warn('[SkillImport] failed to inject copy provenance:', error);
  }
}

function aggregateSourceCounts(
  outcomes: ExternalSkillImportOutcome[]
): ExternalSkillSourceCounts[] {
  const counts = new Map<string, ExternalSkillSourceCounts>();
  for (const outcome of outcomes) {
    let row = counts.get(outcome.agent);
    if (!row) {
      row = {
        agent: outcome.agent,
        agentLabel: outcome.agentLabel,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      };
      counts.set(outcome.agent, row);
    }
    if (outcome.status === 'imported') row.importedCount += 1;
    else if (outcome.status === 'skipped') row.skippedCount += 1;
    else row.failedCount += 1;
  }
  // Registry order first, then any malformed-selection leftovers.
  const ordered: ExternalSkillSourceCounts[] = [];
  const seenAgents = new Set<string>();
  for (const agent of [...EXTERNAL_SKILL_AGENT_SOURCES.map(s => s.key), ...counts.keys()]) {
    if (seenAgents.has(agent)) continue;
    seenAgents.add(agent);
    const row = counts.get(agent);
    if (row) ordered.push(row);
  }
  return ordered;
}

/**
 * Upsert lock entries for the just-imported skills. Runs AFTER the post-import
 * skill-cache refresh (whose lock rebuild normalizes provenance to local
 * defaults), so the external origin is what the lock reports at the end of an
 * import. Copy imports re-read the same frontmatter the rebuild used, making
 * this a no-op for them; symlink imports get their origin restored. Entries
 * for other skills are never dropped.
 */
export function recordImportedExternalSkills(
  options: RecordImportedSkillsOptions
): RecordImportedSkillsResult {
  if (options.imports.length === 0) return { updated: false };
  const lockPath = options.lockPath !== undefined ? options.lockPath : defaultLockPath();
  if (!lockPath) return { updated: false };

  const lock = readSkillsLock(lockPath);
  let updated = false;

  for (const record of options.imports) {
    const skillMdPath = path.join(record.targetPath, 'SKILL.md');
    const raw = (() => {
      try {
        return readFileSync(skillMdPath, 'utf-8');
      } catch {
        console.warn(`[SkillImport] cannot read imported skill for lock: ${skillMdPath}`);
        return null;
      }
    })();
    if (raw === null) continue;

    const info = readSkillFrontmatter(skillMdPath);
    const entry: SkillsLockEntry = {
      name: record.name,
      source: info?.source ?? record.sourceDir,
      sourceType: info?.sourceType ?? record.agent,
      computedHash: computeSkillLockHash(raw),
      ...(info?.version ? { version: info.version } : {}),
    };
    if (JSON.stringify(lock.skills[record.name]) !== JSON.stringify(entry)) {
      lock.skills[record.name] = entry;
      updated = true;
    }
  }

  if (updated) writeSkillsLock(lockPath, lock);
  return { updated };
}
