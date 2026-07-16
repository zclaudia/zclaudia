/**
 * Skill cache + system-prompt formatter.
 *
 * Backed by pi-agent-core: `loadAllSkills` (T1 wrap of pi `loadSourcedSkills`)
 * discovers skills across workspace / external / plugin directories;
 * `formatSkillsForSystemPrompt` emits the `<available_skills>` XML block
 * consumed by templates.
 *
 * Skills are NOT registered as `skill__<id>` MCP tools. Models read SKILL.md
 * on demand via the Read tool.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { minimatch } from 'minimatch';
import { formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core';
import { workspaceService } from '../services/workspace.js';
import type { ExecutionEnv } from '../../infra/execution-env.js';
import {
  loadAllSkills,
  type SkillExecutionMetadata,
  type SkillFrontmatterMetadata,
  type SkillLoadDiagnostic,
  type SkillSource,
  type SourcedSkill,
} from './skill-loader.js';
import { meetsRequirements } from './skill-requirements.js';
import { resolveSkillStatus } from '@zclaudia/shared/core/record-status-resolvers';
import type { RecordStatus } from '@zclaudia/shared/core/record-status';

/**
 * Metadata projection of a discovered skill. Exposed to admin UI / agent API
 * (HTTP) without leaking the full SKILL.md content.
 */
export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  filePath: string;
  dirPath: string;
  eligible?: boolean;
  /** Computed on read for display; not persisted. Completeness is 'ready' here —
   *  draft detection for freshly-seeded skills is handled by the create flow. */
  recordStatus?: RecordStatus;
  requirements?: import('./skill-requirements.js').SkillRequirements;
  metadata?: SkillFrontmatterMetadata;
  execution?: SkillExecutionMetadata;
  usage?: SkillUsage;
}

export interface SkillRef {
  source: SkillSource;
  id: string;
}

export interface SkillUsage {
  count: number;
  lastUsedAt: number;
}

/**
 * Implemented by `skill-bootstrap.pluginSkillReloader`. Declared here (not
 * imported from skill-bootstrap) to break the circular import between
 * skill-tools and skill-bootstrap.
 */
export interface PluginSkillReloader {
  reload(env: ExecutionEnv): Promise<number>;
}

let dbInstance: Database.Database | null = null;
let cached: SourcedSkill[] = [];
let cachedDiagnostics: SkillLoadDiagnostic[] = [];
let activatedConditionalSkillIds = new Set<string>();
let skillUsage = new Map<string, SkillUsage>();

export function setDatabase(db: Database.Database): void {
  dbInstance = db;
  skillUsage = readSkillUsageStore();
}

function skillId(s: SourcedSkill): string {
  // pi loadSkills uses the containing directory name (or root .md filename).
  // We mirror that for dedup and admin display.
  const base = path.basename(path.dirname(s.skill.filePath));
  return base || path.basename(s.skill.filePath, '.md');
}

function skillUsageKey(ref: SkillRef): string {
  return `${ref.source}:${ref.id}`;
}

function skillUsageFor(s: SourcedSkill): SkillUsage | undefined {
  return skillUsage.get(skillUsageKey({ source: s.source, id: skillId(s) }));
}

function readSkillUsageStore(): Map<string, SkillUsage> {
  if (!dbInstance) return new Map(skillUsage);
  try {
    const row = dbInstance
      .prepare(`SELECT value FROM app_config WHERE key = 'skill_usage'`)
      .get() as { value: string } | undefined;
    if (!row) return new Map();
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const entries = Object.entries(parsed).filter((entry): entry is [string, SkillUsage] => {
      const value = entry[1] as SkillUsage;
      return (
        value &&
        typeof value.count === 'number' &&
        Number.isFinite(value.count) &&
        typeof value.lastUsedAt === 'number' &&
        Number.isFinite(value.lastUsedAt)
      );
    });
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function writeSkillUsageStore(): void {
  if (!dbInstance) return;
  try {
    dbInstance
      .prepare(
        `
      INSERT INTO app_config (key, value) VALUES ('skill_usage', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
      )
      .run(JSON.stringify(Object.fromEntries(skillUsage)));
  } catch {
    // Usage ranking is best-effort and should never break skill loading.
  }
}

function byUsageRank(a: SourcedSkill, b: SourcedSkill): number {
  const usageA = skillUsageFor(a);
  const usageB = skillUsageFor(b);
  const countDiff = (usageB?.count ?? 0) - (usageA?.count ?? 0);
  if (countDiff !== 0) return countDiff;
  const recentDiff = (usageB?.lastUsedAt ?? 0) - (usageA?.lastUsedAt ?? 0);
  if (recentDiff !== 0) return recentDiff;
  return 0;
}

function toDiscoveredSkill(s: SourcedSkill): DiscoveredSkill {
  const usage = skillUsageFor(s);
  const eligible = meetsRequirements(s.requirements);
  const recordStatus = resolveSkillStatus({ contentMeaningful: true, eligible });
  return {
    id: skillId(s),
    name: s.skill.name,
    description: s.skill.description,
    source: s.source,
    filePath: s.skill.filePath,
    dirPath: path.dirname(s.skill.filePath),
    eligible,
    recordStatus,
    ...(s.requirements ? { requirements: s.requirements } : {}),
    ...(s.metadata ? { metadata: s.metadata } : {}),
    ...(s.execution ? { execution: s.execution } : {}),
    ...(usage ? { usage } : {}),
  };
}

function hasConditionalPaths(s: SourcedSkill): boolean {
  return (s.metadata?.paths?.length ?? 0) > 0 || (s.metadata?.hookTriggers?.paths?.length ?? 0) > 0;
}

function hasConditionalTools(s: SourcedSkill): boolean {
  return (s.metadata?.hookTriggers?.tools?.length ?? 0) > 0;
}

function hasConditionalActivation(s: SourcedSkill): boolean {
  return hasConditionalPaths(s) || hasConditionalTools(s);
}

function isConditionalSkillActive(s: SourcedSkill): boolean {
  return !hasConditionalActivation(s) || activatedConditionalSkillIds.has(skillId(s));
}

export function getDiscoveredSkills(): DiscoveredSkill[] {
  return cached
    .map((skill, index) => ({ skill, index }))
    .sort((a, b) => byUsageRank(a.skill, b.skill) || a.index - b.index)
    .map(({ skill }) => toDiscoveredSkill(skill));
}

export function getSkillLoadDiagnostics(): SkillLoadDiagnostic[] {
  return [...cachedDiagnostics];
}

export function addSkillLoadDiagnostics(diagnostics: SkillLoadDiagnostic[]): void {
  cachedDiagnostics.push(...diagnostics);
}

export function getEligibleDiscoveredSkills(): DiscoveredSkill[] {
  return cached
    .map((skill, index) => ({ skill, index }))
    .filter(({ skill }) => meetsRequirements(skill.requirements))
    .filter(({ skill }) => isConditionalSkillActive(skill))
    .sort((a, b) => byUsageRank(a.skill, b.skill) || a.index - b.index)
    .map(({ skill }) => toDiscoveredSkill(skill));
}

export function recordSkillUsage(ref: SkillRef, now = Date.now()): SkillUsage {
  const key = skillUsageKey(ref);
  const current = skillUsage.get(key);
  const next = {
    count: (current?.count ?? 0) + 1,
    lastUsedAt: now,
  };
  skillUsage.set(key, next);
  writeSkillUsageStore();
  return next;
}

export function activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
  const activated: string[] = [];
  for (const skill of cached) {
    const id = skillId(skill);
    const patterns = [
      ...(skill.metadata?.paths ?? []),
      ...(skill.metadata?.hookTriggers?.paths ?? []),
    ];
    if (!patterns?.length || activatedConditionalSkillIds.has(id)) continue;
    const matched = filePaths.some(filePath => {
      const relativePath = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath))
        return false;
      return patterns.some(pattern => minimatch(relativePath, pattern, { dot: true }));
    });
    if (matched) {
      activatedConditionalSkillIds.add(id);
      activated.push(id);
    }
  }
  return activated;
}

export function activateConditionalSkillsForToolNames(toolNames: string[]): string[] {
  const requestedTools = new Set(toolNames.map(tool => tool.toLowerCase()));
  const activated: string[] = [];
  for (const skill of cached) {
    const id = skillId(skill);
    const tools = skill.metadata?.hookTriggers?.tools;
    if (!tools?.length || activatedConditionalSkillIds.has(id)) continue;
    if (tools.some(tool => requestedTools.has(tool.toLowerCase()))) {
      activatedConditionalSkillIds.add(id);
      activated.push(id);
    }
  }
  return activated;
}

function findCachedSkill(ref: SkillRef): SourcedSkill | undefined {
  if (path.basename(ref.id) !== ref.id || ref.id.includes('..')) return undefined;
  return cached.find(s => s.source === ref.source && skillId(s) === ref.id);
}

export async function loadDiscoveredSkillContent(ref: SkillRef): Promise<string | null> {
  const skill = findCachedSkill(ref);
  if (!skill || !meetsRequirements(skill.requirements)) return null;
  try {
    return await readFile(skill.skill.filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function loadDiscoveredSkillContentSync(ref: SkillRef): string | null {
  const skill = findCachedSkill(ref);
  if (!skill || !meetsRequirements(skill.requirements)) return null;
  try {
    return readFileSync(skill.skill.filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function getExternalSkillDirs(): string[] {
  if (!dbInstance) return [];
  try {
    const row = dbInstance
      .prepare(`SELECT value FROM app_config WHERE key = 'skill_extra_dirs'`)
      .get() as { value: string } | undefined;
    if (!row) return [];
    const dirs = JSON.parse(row.value);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

export function saveExternalSkillDirs(dirs: string[]): void {
  if (!dbInstance) return;
  dbInstance
    .prepare(
      `
    INSERT INTO app_config (key, value) VALUES ('skill_extra_dirs', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
    )
    .run(JSON.stringify(dirs));
}

function getWellKnownSkillDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return [];
  return [path.join(home, '.zclaudia', 'skills'), path.join(home, '.agents', 'skills')];
}

export function getWorkspaceSkillDir(): string {
  return path.join(workspaceService.getWorkspaceDir(), 'skills');
}

export function getSkillWatchDirs(): string[] {
  return [getWorkspaceSkillDir(), ...getWellKnownSkillDirs(), ...getExternalSkillDirs()];
}

/**
 * Load skills from workspace + external directories into the cache. Plugin
 * skills are NOT loaded here — T3's loadAndCachePluginSkills helper merges
 * them in afterwards via addPluginSkills.
 *
 * Dedup: workspace wins over external on id collision (first-seen).
 */
export async function loadAndCacheSkills(env: ExecutionEnv): Promise<number> {
  const workspaceDir = getWorkspaceSkillDir();
  const externalDirs = [...getWellKnownSkillDirs(), ...getExternalSkillDirs()];

  const inputs: Array<{ path: string; source: SkillSource }> = [
    { path: workspaceDir, source: 'workspace' },
    ...externalDirs.map(p => ({ path: p, source: 'external' as const })),
  ];

  const result = await loadAllSkills(env, inputs);

  const seen = new Set<string>();
  const deduped: SourcedSkill[] = [];
  for (const s of result.skills) {
    const id = skillId(s);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(s);
  }
  cached = deduped;
  cachedDiagnostics = result.diagnostics;
  activatedConditionalSkillIds = new Set(
    [...activatedConditionalSkillIds].filter(id => deduped.some(skill => skillId(skill) === id))
  );

  for (const d of result.diagnostics) {
    console.warn(`[SkillLoader] ${d.code} (${d.source}): ${d.message} — ${d.path}`);
  }
  if (cached.length > 0) {
    console.log(
      `[SkillLoader] loaded ${cached.length} skill(s): ${cached.map(s => s.skill.name).join(', ')}`
    );
  }
  return cached.length;
}

export async function refreshSkillCache(
  env: ExecutionEnv,
  pluginReloader?: PluginSkillReloader
): Promise<number> {
  cached = [];
  cachedDiagnostics = [];
  activatedConditionalSkillIds = new Set();
  const wsCount = await loadAndCacheSkills(env);
  const pluginCount = pluginReloader ? await pluginReloader.reload(env) : 0;
  return wsCount + pluginCount;
}

/**
 * Merge plugin skills into the existing cache. Workspace/external wins on id
 * collision; plugin skills with conflicting ids are skipped.
 *
 * Called by skill-bootstrap.loadAndCachePluginSkills in T3.
 */
export function addPluginSkills(skills: SourcedSkill[]): void {
  const seen = new Set(cached.map(s => skillId(s)));
  for (const s of skills) {
    const id = skillId(s);
    if (seen.has(id)) continue;
    seen.add(id);
    cached.push(s);
  }
}

/**
 * Build the `<available_skills>` XML block for system prompts. Filters out
 * skills whose runtime requirements (OS / binaries / env) are not satisfied.
 * Returns empty string when no eligible skill remains.
 */
export function buildSkillDirectoryHint(): string {
  const eligible = cached
    .filter(s => meetsRequirements(s.requirements))
    .filter(isConditionalSkillActive)
    .map(s => s.skill);
  if (eligible.length === 0) return '';
  return formatSkillsForSystemPrompt(eligible);
}
