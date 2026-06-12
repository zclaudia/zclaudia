import type { AgentTool } from '@earendil-works/pi-agent-core';
import * as fs from 'fs';
import * as path from 'path';

import { errorResult, textResult, truncateText } from './tool-common.js';

export interface MemoryToolOptions {
  memoryDir: string;
}

const VIRTUAL_ROOT = '/memories';

const DESCRIPTION = `Persistent project memory, mounted at ${VIRTUAL_ROOT}. Files here survive across sessions — this is how you remember things for future conversations.

What to save: user corrections and preferences, project decisions or constraints not derivable from the code, hard-won debugging lessons, pointers to external resources. What NOT to save: anything discoverable from the codebase or git history, or details only relevant to the current session.

Conventions: one fact per markdown file with a one-line "description:" frontmatter. ${VIRTUAL_ROOT}/MEMORY.md is the index (one line per memory: "- [title](file.md) — hook") and is injected into your system prompt each session. After creating, renaming, or deleting a memory file, update MEMORY.md in the same turn. Update or delete stale memories instead of duplicating them.`;

type Resolved = { abs: string };
type ResolveFailure = { error: { code: string; message: string } };

function resolveVirtualPath(memoryDir: string, raw: unknown): Resolved | ResolveFailure {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: { code: 'invalid_path', message: `path is required and must start with ${VIRTUAL_ROOT}/` } };
  }
  const trimmed = raw.trim();
  if (trimmed !== VIRTUAL_ROOT && !trimmed.startsWith(`${VIRTUAL_ROOT}/`)) {
    return { error: { code: 'invalid_path', message: `path must start with ${VIRTUAL_ROOT}/ (got: ${trimmed})` } };
  }
  const rel = trimmed === VIRTUAL_ROOT ? '' : trimmed.slice(VIRTUAL_ROOT.length + 1);
  const root = path.resolve(memoryDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return { error: { code: 'path_escape', message: 'path escapes the memory directory' } };
  }
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) {
    return { error: { code: 'symlink_not_allowed', message: 'symlinks are not allowed in memory' } };
  }
  // Guard against symlinked intermediate directories (only when abs is strictly inside root).
  if (abs !== root) {
    const existingParent = (() => {
      let p = path.dirname(abs);
      while (p !== root && p.startsWith(root + path.sep) && !fs.existsSync(p)) {
        p = path.dirname(p);
      }
      return p;
    })();
    if (existingParent !== root && existingParent.startsWith(root + path.sep) && fs.existsSync(existingParent)) {
      const realParent = fs.realpathSync(existingParent);
      const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
      if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
        return { error: { code: 'symlink_not_allowed', message: 'memory path resolves outside the memory directory' } };
      }
    }
  }
  return { abs };
}

function isFailure(r: Resolved | ResolveFailure): r is ResolveFailure {
  return 'error' in r;
}

function listFiles(root: string): string {
  if (!fs.existsSync(root)) return '(no memories yet)';
  const entries = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(e.parentPath, e.name);
      const rel = path.relative(root, full);
      const size = fs.statSync(full).size;
      return `${VIRTUAL_ROOT}/${rel} (${size} bytes)`;
    })
    .sort();
  return entries.length ? entries.join('\n') : '(no memories yet)';
}

function numberedLines(content: string, range?: [number, number]): string {
  const lines = content.split('\n');
  const [start, end] = range ?? [1, lines.length];
  return lines
    .slice(Math.max(0, start - 1), end)
    .map((line, i) => `${start + i}\t${line}`)
    .join('\n');
}

export function createMemoryTool(options: MemoryToolOptions): AgentTool<any> {
  const { memoryDir } = options;
  return {
    name: 'Memory',
    label: 'Memory',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'],
          description: 'Operation to perform on the memory directory',
        },
        path: { type: 'string', description: `Path inside ${VIRTUAL_ROOT}, e.g. ${VIRTUAL_ROOT}/MEMORY.md` },
        view_range: { type: 'array', items: { type: 'number' }, description: 'Optional [startLine, endLine] for view' },
        file_text: { type: 'string', description: 'Full file content for create' },
        old_str: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
        new_str: { type: 'string', description: 'Replacement text' },
        insert_line: { type: 'number', description: 'Insert after this line number (0 = top of file)' },
        insert_text: { type: 'string', description: 'Text to insert' },
        old_path: { type: 'string', description: 'Source path for rename' },
        new_path: { type: 'string', description: 'Destination path for rename' },
      },
      required: ['command'],
    } as any,
    execute: async (_toolCallId: string, params: unknown) => {
      const args = params && typeof params === 'object' ? params as Record<string, unknown> : {};
      const command = String(args.command ?? '');
      try {
        switch (command) {
          case 'view': {
            const target = args.path === undefined ? VIRTUAL_ROOT : args.path;
            const resolved = resolveVirtualPath(memoryDir, target);
            if (isFailure(resolved)) return errorResult(resolved.error.code, resolved.error.message);
            if (!fs.existsSync(resolved.abs)) return errorResult('not_found', `${String(target)} does not exist`);
            if (fs.statSync(resolved.abs).isDirectory()) {
              return textResult(truncateText(listFiles(resolved.abs)), { ok: true, kind: 'directory' });
            }
            const range = Array.isArray(args.view_range) && args.view_range.length === 2
              ? [Number(args.view_range[0]), Number(args.view_range[1])] as [number, number]
              : undefined;
            return textResult(truncateText(numberedLines(fs.readFileSync(resolved.abs, 'utf8'), range)), { ok: true, kind: 'file' });
          }
          case 'create': {
            const resolved = resolveVirtualPath(memoryDir, args.path);
            if (isFailure(resolved)) return errorResult(resolved.error.code, resolved.error.message);
            if (typeof args.file_text !== 'string') return errorResult('invalid_params', 'create requires file_text');
            fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
            fs.writeFileSync(resolved.abs, args.file_text, 'utf8');
            return textResult(`Created ${String(args.path)}`, { ok: true });
          }
          case 'str_replace': {
            const resolved = resolveVirtualPath(memoryDir, args.path);
            if (isFailure(resolved)) return errorResult(resolved.error.code, resolved.error.message);
            if (typeof args.old_str !== 'string' || typeof args.new_str !== 'string') {
              return errorResult('invalid_params', 'str_replace requires old_str and new_str');
            }
            if (!fs.existsSync(resolved.abs)) return errorResult('not_found', `${String(args.path)} does not exist`);
            const content = fs.readFileSync(resolved.abs, 'utf8');
            const occurrences = content.split(args.old_str).length - 1;
            if (occurrences === 0) return errorResult('not_found', 'old_str not found in file — view the file and retry with exact text');
            if (occurrences > 1) return errorResult('not_unique', `old_str appears ${occurrences} times — include more surrounding context to make it unique`);
            fs.writeFileSync(resolved.abs, content.replace(args.old_str, args.new_str), 'utf8');
            return textResult(`Replaced text in ${String(args.path)}`, { ok: true });
          }
          case 'insert': {
            const resolved = resolveVirtualPath(memoryDir, args.path);
            if (isFailure(resolved)) return errorResult(resolved.error.code, resolved.error.message);
            const line = Number(args.insert_line);
            if (!Number.isInteger(line) || line < 0 || typeof args.insert_text !== 'string') {
              return errorResult('invalid_params', 'insert requires insert_line (>= 0) and insert_text');
            }
            if (!fs.existsSync(resolved.abs)) return errorResult('not_found', `${String(args.path)} does not exist`);
            const lines = fs.readFileSync(resolved.abs, 'utf8').split('\n');
            if (line > lines.length) return errorResult('invalid_params', `insert_line ${line} is beyond end of file (${lines.length} lines)`);
            lines.splice(line, 0, args.insert_text);
            fs.writeFileSync(resolved.abs, lines.join('\n'), 'utf8');
            return textResult(`Inserted text at line ${line} in ${String(args.path)}`, { ok: true });
          }
          case 'delete': {
            const resolved = resolveVirtualPath(memoryDir, args.path);
            if (isFailure(resolved)) return errorResult(resolved.error.code, resolved.error.message);
            if (resolved.abs === path.resolve(memoryDir)) return errorResult('cannot_delete_root', `cannot delete ${VIRTUAL_ROOT} itself`);
            if (!fs.existsSync(resolved.abs)) return errorResult('not_found', `${String(args.path)} does not exist`);
            fs.rmSync(resolved.abs, { recursive: true });
            return textResult(`Deleted ${String(args.path)}`, { ok: true });
          }
          case 'rename': {
            const from = resolveVirtualPath(memoryDir, args.old_path);
            if (isFailure(from)) return errorResult(from.error.code, from.error.message);
            const to = resolveVirtualPath(memoryDir, args.new_path);
            if (isFailure(to)) return errorResult(to.error.code, to.error.message);
            if (!fs.existsSync(from.abs)) return errorResult('not_found', `${String(args.old_path)} does not exist`);
            fs.mkdirSync(path.dirname(to.abs), { recursive: true });
            fs.renameSync(from.abs, to.abs);
            return textResult(`Renamed ${String(args.old_path)} to ${String(args.new_path)}`, { ok: true });
          }
          default:
            return errorResult('invalid_command', `Unknown command: ${command}`);
        }
      } catch (err) {
        return errorResult('io_error', err instanceof Error ? err.message : String(err));
      }
    },
  } as unknown as AgentTool<any>;
}
