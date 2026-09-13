import { createHash } from 'crypto';
import { readdir, readFile, realpath } from 'fs/promises';
import path from 'path';
import type {
  InvocableDiagnostic,
  InvocableScope,
  PortableSkillAssessment,
  PortableSkillCandidate,
  RuntimeDiscoveryContext,
  RuntimeInvocableCatalog,
  RuntimeInvocableRecord,
  RuntimeInvocationCapabilities,
} from '@zclaudia/plugin-sdk/invocations';

/**
 * URIP adapter for the Claude runtime (design doc §14.1, §29 step 6.3).
 *
 * Catalog: Claude's documented command roots, reproduced with Claude's own
 * source and precedence rules *inside this plugin* — the host never scans
 * provider directories (§26.2, acceptance criterion 1). Precedence for
 * discovery listing (both scopes are listed; execution precedence stays with
 * the runtime):
 *
 *   1. project `.claude/commands/**\/*.md`   (scope: project)
 *   2. user    `~/.claude/commands/**\/*.md` (scope: user)
 *
 * Namespaces use the documented directory nesting (`commands/a/b.md` →
 * `/a:b`). Execution is `native-text` with exact fidelity: the adapter
 * forwards the exact `/trigger args` text to the CLI. ZClaudia portable
 * skills are `emulated` (§13.2) — compiled into an ordinary prompt, labeled
 * best-effort, and only when they carry no resource requirements.
 */

export const MAX_COMMAND_FILE_BYTES = 256 * 1024;
export const MAX_COMMAND_ENTRIES = 500;
export const MAX_NAMESPACE_DEPTH = 2;

export interface ClaudeInvocationsDeps {
  home: string;
  /** Directory reader seam for tests. */
  readdir?: typeof readdir;
  readFile?: typeof readFile;
  realpath?: typeof realpath;
}

interface CommandFile {
  providerLocalKey: string;
  scope: InvocableScope;
  displayTrigger: string;
  description: string | undefined;
  absolutePath: string;
  contentDigest: string;
}

/** Bounded, untrusted frontmatter `description:` extraction (§18.2). */
function readDescription(markdown: string): string | undefined {
  if (!markdown.startsWith('---')) return undefined;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return undefined;
  const frontmatter = markdown.slice(3, end);
  const match = /^description:\s*(.+)$/m.exec(frontmatter);
  if (!match) return undefined;
  const raw = match[1].trim().replace(/^["']|["']$/g, '');
  return raw ? raw.slice(0, 512) : undefined;
}

async function scanCommandRoot(
  root: string,
  scope: InvocableScope,
  deps: Required<Pick<ClaudeInvocationsDeps, 'readdir' | 'readFile' | 'realpath'>>,
  diagnostics: InvocableDiagnostic[]
): Promise<CommandFile[]> {
  const files: CommandFile[] = [];
  let realRoot: string;
  try {
    realRoot = await deps.realpath(root);
  } catch {
    return files; // Root absent for this installation — not an error.
  }

  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (files.length >= MAX_COMMAND_ENTRIES) return;
    let entries;
    try {
      entries = await deps.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_COMMAND_ENTRIES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= MAX_NAMESPACE_DEPTH) continue;
        await walk(full, prefix ? `${prefix}:${entry.name}` : entry.name, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      let content: string;
      try {
        content = await deps.readFile(full, 'utf8');
      } catch {
        continue;
      }
      if (content.length > MAX_COMMAND_FILE_BYTES) {
        diagnostics.push({
          severity: 'warning',
          code: 'INVOCATION_DISCOVERY_FAILED',
          message: `Command file exceeds the ${MAX_COMMAND_FILE_BYTES} byte bound and was skipped.`,
          runtimeType: 'claude',
        });
        continue;
      }
      const base = entry.name.slice(0, -3);
      const localKey = prefix ? `${prefix}:${base}` : base;
      files.push({
        providerLocalKey: localKey,
        scope,
        displayTrigger: `/${localKey}`,
        description: readDescription(content),
        absolutePath: full,
        contentDigest: createHash('sha256').update(content).digest('base64url'),
      });
    }
  };

  await walk(realRoot, '', 0);
  return files;
}

export function createClaudeInvocations(deps: ClaudeInvocationsDeps) {
  const readdirImpl = deps.readdir ?? readdir;
  const readFileImpl = deps.readFile ?? readFile;
  const realpathImpl = deps.realpath ?? realpath;
  const seams = { readdir: readdirImpl, readFile: readFileImpl, realpath: realpathImpl };

  const provider = {
    async capabilities(_context: RuntimeDiscoveryContext): Promise<RuntimeInvocationCapabilities> {
      return {
        catalog: 'filesystem',
        executionModes: ['native-text'],
        refresh: 'manual',
        discoveryScope: 'shared-context',
        catalogLifecycle: 'bootstrap-only',
        unknownTextPassthrough: true,
        portableSkills: 'emulated',
      };
    },

    async discover(
      context: RuntimeDiscoveryContext,
      signal: AbortSignal
    ): Promise<RuntimeInvocableCatalog> {
      if (signal.aborted) throw new Error('discovery aborted');
      const diagnostics: InvocableDiagnostic[] = [];

      const projectRoot = path.join(context.canonicalCwd, '.claude', 'commands');
      const userRoot = path.join(deps.home, '.claude', 'commands');
      const [projectFiles, userFiles] = await Promise.all([
        scanCommandRoot(projectRoot, 'project', seams, diagnostics),
        scanCommandRoot(userRoot, 'user', seams, diagnostics),
      ]);

      const records: RuntimeInvocableRecord[] = [];
      const seen = new Set<string>();
      for (const file of [...projectFiles, ...userFiles]) {
        if (seen.has(`${file.scope}:${file.providerLocalKey}`)) continue;
        seen.add(`${file.scope}:${file.providerLocalKey}`);
        records.push({
          descriptor: {
            kind: 'runtime.command',
            runtimeType: 'claude',
            name: file.providerLocalKey,
            label: file.providerLocalKey,
            ...(file.description ? { description: file.description } : {}),
            displayTrigger: file.displayTrigger,
            origin: { owner: 'runtime', scope: file.scope },
            execution: {
              mode: 'native-text',
              fidelity: 'exact',
              arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
            },
            availability: { available: true },
          },
          providerLocalKey: `${file.scope}:${file.providerLocalKey}`,
          nativeLocator: { type: 'claude-command', file: file.absolutePath },
          contentDigest: file.contentDigest,
        });
      }

      return {
        items: records,
        diagnostics,
        phase: 'live',
        completeness: 'complete',
      };
    },

    async assessPortableSkill(
      skill: PortableSkillCandidate,
      _context: RuntimeDiscoveryContext,
      _signal: AbortSignal
    ): Promise<PortableSkillAssessment> {
      // Emulated compilation is plain prompt text: a skill that requires
      // resources cannot honor them through this transport (§13.2).
      if (skill.resourceManifest.length > 0) {
        return {
          supported: false,
          mode: 'unsupported',
          code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
          reason:
            'This skill requires resource files, which emulated Claude execution cannot provide.',
        };
      }
      return {
        supported: true,
        mode: 'emulated',
        executionMode: 'emulated',
        fidelity: 'best-effort',
        resourceAccess: 'none',
      };
    },
  };

  return provider;
}
