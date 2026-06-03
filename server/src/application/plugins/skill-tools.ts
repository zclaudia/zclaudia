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
import type Database from 'better-sqlite3';
import { formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core';
import { workspaceService } from '../services/workspace.js';
import type { ExecutionEnv } from '../../infra/execution-env.js';
import { loadAllSkills, type SkillSource, type SourcedSkill } from './skill-loader.js';
import { meetsRequirements } from './skill-requirements.js';

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
}

let dbInstance: Database.Database | null = null;
let cached: SourcedSkill[] = [];

export function setDatabase(db: Database.Database): void {
  dbInstance = db;
}

function skillId(s: SourcedSkill): string {
  // pi loadSkills uses the containing directory name (or root .md filename).
  // We mirror that for dedup and admin display.
  const base = path.basename(path.dirname(s.skill.filePath));
  return base || path.basename(s.skill.filePath, '.md');
}

function toDiscoveredSkill(s: SourcedSkill): DiscoveredSkill {
  return {
    id: skillId(s),
    name: s.skill.name,
    description: s.skill.description,
    source: s.source,
    filePath: s.skill.filePath,
    dirPath: path.dirname(s.skill.filePath),
  };
}

export function getDiscoveredSkills(): DiscoveredSkill[] {
  return cached.map(toDiscoveredSkill);
}

export function getExternalSkillDirs(): string[] {
  if (!dbInstance) return [];
  try {
    const row = dbInstance.prepare(
      `SELECT value FROM app_config WHERE key = 'skill_extra_dirs'`,
    ).get() as { value: string } | undefined;
    if (!row) return [];
    const dirs = JSON.parse(row.value);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

export function saveExternalSkillDirs(dirs: string[]): void {
  if (!dbInstance) return;
  dbInstance.prepare(`
    INSERT INTO app_config (key, value) VALUES ('skill_extra_dirs', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(dirs));
}

function getWellKnownSkillDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return [];
  return [
    path.join(home, '.zclaudia', 'skills'),
    path.join(home, '.agents', 'skills'),
  ];
}

/**
 * Load skills from workspace + external directories into the cache. Plugin
 * skills are NOT loaded here — T3's loadAndCachePluginSkills helper merges
 * them in afterwards via addPluginSkills.
 *
 * Dedup: workspace wins over external on id collision (first-seen).
 */
export async function loadAndCacheSkills(env: ExecutionEnv): Promise<number> {
  const workspaceDir = path.join(workspaceService.getWorkspaceDir(), 'skills');
  const externalDirs = [...getWellKnownSkillDirs(), ...getExternalSkillDirs()];

  const inputs: Array<{ path: string; source: SkillSource }> = [
    { path: workspaceDir, source: 'workspace' },
    ...externalDirs.map((p) => ({ path: p, source: 'external' as const })),
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

  for (const d of result.diagnostics) {
    console.warn(`[SkillLoader] ${d.code} (${d.source}): ${d.message} — ${d.path}`);
  }
  if (cached.length > 0) {
    console.log(`[SkillLoader] loaded ${cached.length} skill(s): ${cached.map((s) => s.skill.name).join(', ')}`);
  }
  return cached.length;
}

export async function refreshSkillCache(env: ExecutionEnv): Promise<number> {
  cached = [];
  return loadAndCacheSkills(env);
}

/**
 * Merge plugin skills into the existing cache. Workspace/external wins on id
 * collision; plugin skills with conflicting ids are skipped.
 *
 * Called by skill-bootstrap.loadAndCachePluginSkills in T3.
 */
export function addPluginSkills(skills: SourcedSkill[]): void {
  const seen = new Set(cached.map((s) => skillId(s)));
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
    .filter((s) => meetsRequirements(s.requirements))
    .map((s) => s.skill);
  if (eligible.length === 0) return '';
  return formatSkillsForSystemPrompt(eligible);
}
