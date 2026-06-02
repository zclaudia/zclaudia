/**
 * Skill Tools - Registers workspace and external skills as MCP bridge tools.
 *
 * Skills are discovered from:
 * 1. Workspace skills directory (~/.zclaudia/workspace/skills/)
 * 2. External skill directories (configured via app_config 'skill_extra_dirs')
 *
 * Each skill with a valid SKILL.md is registered as a tool with prefix `skill__`.
 * AI providers call these tools on demand to load full skill content (lazy loading).
 */

import * as path from 'path';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import { workspaceService } from '../services/workspace.js';
import { toolRegistry } from './tool-registry.js';
import { unwrapResult, type ExecutionEnv } from '../../infra/execution-env.js';

interface SkillTriggers {
  keywords?: string[];
  projectType?: string[];
}

interface SkillRequires {
  os?: string[];
  binaries?: string[];
  env?: string[];
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  dirPath: string;
  source: 'workspace' | 'external';
  triggers?: SkillTriggers;
  requires?: SkillRequires;
  priority: number;
}

const MAX_SKILL_CONTENT_SIZE = 50 * 1024;
const MAX_RECURSION_DEPTH = 5;
const TOOL_PREFIX = 'skill__';

let dbInstance: Database.Database | null = null;
let discoveredSkills: SkillMeta[] = [];

export function setDatabase(db: Database.Database): void {
  dbInstance = db;
}

export function getDiscoveredSkills(): SkillMeta[] {
  return discoveredSkills;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  triggers?: SkillTriggers;
  requires?: SkillRequires;
  priority?: number;
}

interface ParsedSkillFile {
  frontmatter: ParsedFrontmatter;
  body: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length > 0 ? values : undefined;
}

export function parseSkillFile(content: string): ParsedSkillFile {
  try {
    const parsed = matter(content);
    const data = toRecord(parsed.data) ?? {};

    const frontmatter: ParsedFrontmatter = {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      priority: typeof data.priority === 'number' && Number.isFinite(data.priority)
        ? data.priority
        : undefined,
    };

    const triggerData = toRecord(data.triggers);
    if (triggerData) {
      const triggers: SkillTriggers = {};
      const keywords = toStringArray(triggerData.keywords);
      const projectType = toStringArray(triggerData.projectType);
      if (keywords) triggers.keywords = keywords;
      if (projectType) triggers.projectType = projectType;
      if (triggers.keywords || triggers.projectType) {
        frontmatter.triggers = triggers;
      }
    }

    const requiresData = toRecord(data.requires);
    if (requiresData) {
      const requires: SkillRequires = {};
      const os = toStringArray(requiresData.os);
      const binaries = toStringArray(requiresData.binaries);
      const envField = toStringArray(requiresData.env);
      if (os) requires.os = os;
      if (binaries) requires.binaries = binaries;
      if (envField) requires.env = envField;
      if (requires.os || requires.binaries || requires.env) {
        frontmatter.requires = requires;
      }
    }

    return {
      frontmatter,
      body: parsed.content,
    };
  } catch {
    return {
      frontmatter: {},
      body: content,
    };
  }
}

export async function discoverSkillsInDir(
  env: ExecutionEnv,
  dir: string,
  source: 'workspace' | 'external',
  maxDepth: number = MAX_RECURSION_DEPTH,
): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];

  if (maxDepth <= 0) {
    console.warn(`[SkillTools] Max recursion depth reached, skipping: ${dir}`);
    return skills;
  }

  const existsResult = await env.exists(dir);
  if (!existsResult.ok || !existsResult.value) {
    return skills;
  }

  const listResult = await env.listDir(dir);
  if (!listResult.ok) {
    return skills;
  }

  for (const entry of listResult.value) {
    if (entry.kind !== 'directory') {
      continue;
    }

    const subdir = path.join(dir, entry.name);
    const skillMdPath = path.join(subdir, 'SKILL.md');

    const skillExists = await env.exists(skillMdPath);
    if (skillExists.ok && skillExists.value) {
      try {
        const content = unwrapResult(await env.readTextFile(skillMdPath));
        const parsed = parseSkillFile(content);
        const frontmatter = parsed.frontmatter;
        const lines = parsed.body.split('\n').filter((line) => line.trim());
        const name = frontmatter.name || lines[0]?.replace(/^#\s*/, '') || entry.name;
        const description = frontmatter.description || lines[1]?.replace(/^>\s*/, '') || '';

        skills.push({
          id: entry.name,
          name,
          description,
          dirPath: subdir,
          source,
          triggers: frontmatter.triggers,
          requires: frontmatter.requires,
          priority: frontmatter.priority ?? 100,
        });
      } catch {
        // Skip unreadable skills.
      }
    } else {
      const nested = await discoverSkillsInDir(env, subdir, source, maxDepth - 1);
      skills.push(...nested);
    }
  }

  return skills;
}

export async function loadSkillContent(env: ExecutionEnv, dirPath: string): Promise<string> {
  const parts: string[] = [];
  const skillMdPath = path.join(dirPath, 'SKILL.md');

  const skillRead = await env.readTextFile(skillMdPath);
  if (!skillRead.ok) {
    return `Skill file not found: ${skillMdPath}`;
  }
  parts.push(skillRead.value);

  const referencesDir = path.join(dirPath, 'references');
  const refsExist = await env.exists(referencesDir);
  if (refsExist.ok && refsExist.value) {
    const refList = await env.listDir(referencesDir);
    if (refList.ok) {
      for (const reference of refList.value) {
        if (reference.kind !== 'file' || !reference.name.endsWith('.md')) {
          continue;
        }
        const refRead = await env.readTextFile(path.join(referencesDir, reference.name));
        if (refRead.ok) {
          parts.push(`\n---\n## Reference: ${reference.name}\n\n${refRead.value}`);
        }
      }
    }
  }

  const combined = parts.join('\n');
  if (combined.length > MAX_SKILL_CONTENT_SIZE) {
    return `${combined.slice(0, MAX_SKILL_CONTENT_SIZE)}\n\n[Content truncated at 50KB limit]`;
  }
  return combined;
}

export function getExternalSkillDirs(): string[] {
  if (!dbInstance) {
    return [];
  }

  try {
    const row = dbInstance.prepare(
      `SELECT value FROM app_config WHERE key = 'skill_extra_dirs'`
    ).get() as { value: string } | undefined;
    if (!row) {
      return [];
    }
    const dirs = JSON.parse(row.value);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

export function saveExternalSkillDirs(dirs: string[]): void {
  if (!dbInstance) {
    return;
  }

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

export async function registerSkillTools(env: ExecutionEnv): Promise<number> {
  const allSkills: SkillMeta[] = [];
  const seenIds = new Set<string>();

  const workspaceSkillsDir = path.join(workspaceService.getWorkspaceDir(), 'skills');
  for (const skill of await discoverSkillsInDir(env, workspaceSkillsDir, 'workspace')) {
    if (!seenIds.has(skill.id)) {
      seenIds.add(skill.id);
      allSkills.push(skill);
    }
  }

  for (const dir of [...getWellKnownSkillDirs(), ...getExternalSkillDirs()]) {
    for (const skill of await discoverSkillsInDir(env, dir, 'external')) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        allSkills.push(skill);
      }
    }
  }

  for (const skill of allSkills) {
    const toolId = `${TOOL_PREFIX}${skill.id}`;
    toolRegistry.register({
      id: toolId,
      definition: {
        type: 'function',
        function: {
          name: toolId,
          description: `[Skill] ${skill.name}: ${skill.description}`,
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What you want to accomplish with this skill (optional context)',
              },
            },
          },
        },
      },
      source: 'skill',
      handler: async () => loadSkillContent(env, skill.dirPath),
    });
  }

  discoveredSkills = allSkills;

  if (allSkills.length > 0) {
    console.log(`[SkillTools] Registered ${allSkills.length} skill(s): ${allSkills.map((skill) => skill.id).join(', ')}`);
  }

  return allSkills.length;
}

export async function refreshSkillTools(env: ExecutionEnv): Promise<number> {
  toolRegistry.removeBySource('skill');
  return registerSkillTools(env);
}

export function buildSkillDirectoryHint(): string {
  const skillTools = toolRegistry.getAll().filter((tool) => tool.source === 'skill');
  if (skillTools.length === 0) {
    return '';
  }

  const lines = skillTools.map((tool) => {
    const fn = tool.definition.function;
    return `- ${fn.name}: ${fn.description?.replace(/^\[Skill\]\s*/, '') || ''}`;
  });

  return [
    '## Available Skills',
    '',
    'Call the corresponding tool to load full instructions:',
    ...lines,
  ].join('\n');
}
