import { readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { loadSourcedSkills, type Skill } from '@earendil-works/pi-agent-core';
import type { SkillExecutionMode, SkillForkToolPolicy } from '@zclaudia/shared/core/skills';
import type { ExecutionEnv } from '../../infra/execution-env.js';
import type { SkillRequirements } from './skill-requirements.js';

/** Where a discovered skill came from. Application-defined; pi treats it opaquely. */
export type SkillSource = 'workspace' | 'external' | 'plugin';

/** Skill with provenance + parsed requirements. */
export interface SourcedSkill {
  skill: Skill;
  source: SkillSource;
  /** Parsed from SKILL.md frontmatter `requires:` block. Pi does not surface these. */
  requirements?: SkillRequirements;
  /** Parsed from SKILL.md frontmatter execution policy fields. */
  execution?: SkillExecutionMetadata;
}

export interface SkillExecutionMetadata {
  allowedModes?: SkillExecutionMode[];
  defaultMode?: SkillExecutionMode;
  forkToolPolicy?: SkillForkToolPolicy;
}

export interface SkillLoadDiagnostic {
  type: 'warning';
  code: string;
  message: string;
  path: string;
  source: SkillSource;
}

export interface SkillLoadResult {
  skills: SourcedSkill[];
  diagnostics: SkillLoadDiagnostic[];
}

/**
 * Read the raw SKILL.md file and extract the `requires:` block from frontmatter.
 * Pi strips frontmatter before setting `skill.content`, so we read the file again.
 */
function extractRequirements(filePath: string): SkillRequirements | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const requires = (data.requires ?? {}) as Record<string, unknown>;
    const arr = (v: unknown): string[] | undefined => {
      if (typeof v === 'string') return [v];
      if (!Array.isArray(v)) return undefined;
      const s = v.filter((x): x is string => typeof x === 'string');
      return s.length ? s : undefined;
    };
    const out: SkillRequirements = {};
    const os = arr(requires.os);
    const binaries = arr(requires.binaries);
    const env = arr(requires.env);
    if (os) out.os = os;
    if (binaries) out.binaries = binaries;
    if (env) out.env = env;
    return Object.keys(out).length ? out : undefined;
  } catch (err) {
    // Malformed frontmatter (bad YAML, file unreadable). Skill still loads with
    // no requirements; warn so the operator can fix it.
    console.warn(`[skill-loader] Failed to parse frontmatter for ${filePath}:`, err);
    return undefined;
  }
}

function normalizeExecutionMode(value: unknown): SkillExecutionMode | undefined {
  return value === 'inline' || value === 'fork' ? value : undefined;
}

function normalizeForkToolPolicy(value: unknown): SkillForkToolPolicy | undefined {
  return value === 'read-only' || value === 'web' || value === 'workspace-edit' || value === 'agent-default'
    ? value
    : undefined;
}

function parseModes(value: unknown): SkillExecutionMode[] | undefined {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const modes = [...new Set(raw.flatMap((mode) => {
    const normalized = normalizeExecutionMode(mode);
    return normalized ? [normalized] : [];
  }))];
  return modes.length > 0 ? modes : undefined;
}

function extractExecutionMetadata(filePath: string): SkillExecutionMetadata | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const nested = data.execution && typeof data.execution === 'object'
      ? data.execution as Record<string, unknown>
      : {};
    const allowedModes = parseModes(nested.allowed_modes ?? nested.allowedModes ?? data.allowed_modes ?? data.allowedModes);
    const defaultMode = normalizeExecutionMode(nested.default_mode ?? nested.defaultMode ?? data.default_mode ?? data.defaultMode);
    const forkToolPolicy = normalizeForkToolPolicy(
      nested.fork_tool_policy ?? nested.forkToolPolicy ?? data.fork_tool_policy ?? data.forkToolPolicy,
    );
    const out: SkillExecutionMetadata = {};
    if (allowedModes) out.allowedModes = allowedModes;
    if (defaultMode) out.defaultMode = defaultMode;
    if (forkToolPolicy) out.forkToolPolicy = forkToolPolicy;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch (err) {
    console.warn(`[skill-loader] Failed to parse execution metadata for ${filePath}:`, err);
    return undefined;
  }
}

/**
 * Discover skills across source-tagged directories via pi `loadSourcedSkills`,
 * then enrich each skill with `requirements` parsed from its frontmatter
 * (pi does not expose `requires`).
 *
 * Missing input directories are silently skipped (pi behavior).
 */
export async function loadAllSkills(
  env: ExecutionEnv,
  inputs: Array<{ path: string; source: SkillSource }>,
): Promise<SkillLoadResult> {
  const result = await loadSourcedSkills<SkillSource>(env, inputs);
  return {
    skills: result.skills.map(({ skill, source }) => ({
      skill,
      source,
      requirements: extractRequirements(skill.filePath),
      execution: extractExecutionMetadata(skill.filePath),
    })),
    diagnostics: result.diagnostics.map((d) => ({
      type: d.type, code: d.code, message: d.message, path: d.path, source: d.source,
    })),
  };
}
