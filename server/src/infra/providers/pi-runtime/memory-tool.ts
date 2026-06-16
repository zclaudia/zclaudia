import type { AgentTool } from '@earendil-works/pi-agent-core';

import { errorResult, textResult, truncateText } from './tool-common.js';
import {
  FileSystemMemoryProvider,
  VIRTUAL_MEMORY_ROOT,
  type MemoryError,
  type MemoryProvider,
} from './memory-provider.js';

export interface MemoryToolOptions {
  memoryDir?: string;
  provider?: MemoryProvider;
}

const DESCRIPTION = `Persistent project memory, mounted at ${VIRTUAL_MEMORY_ROOT}. Files here survive across sessions — this is how you remember things for future conversations.

What to save: user corrections and preferences, project decisions or constraints not derivable from the code, hard-won debugging lessons, pointers to external resources. What NOT to save: anything discoverable from the codebase or git history, or details only relevant to the current session.

Conventions: one fact per markdown file with a one-line "description:" frontmatter. ${VIRTUAL_MEMORY_ROOT}/MEMORY.md is the index (one line per memory: "- [title](file.md) — hook") and is injected into your system prompt each session. After creating, renaming, or deleting a memory file, update MEMORY.md in the same turn. Update or delete stale memories instead of duplicating them.`;

function resultError(result: MemoryError) {
  return errorResult(result.error, result.message, result.details);
}

function resolveProvider(options: MemoryToolOptions): MemoryProvider {
  if (options.provider) return options.provider;
  if (options.memoryDir) return new FileSystemMemoryProvider(options.memoryDir);
  throw new Error('createMemoryTool requires either memoryDir or provider');
}

// Concurrency invariant: every command below uses only synchronous fs calls
// with no await between read and write, so commands are atomic w.r.t. this
// process's event loop (concurrent runs interleave at whole-command granularity,
// worst case last-write-wins). Converting to fs.promises would break this —
// add locking (see file-write-lock.ts) before doing so.
export function createMemoryTool(options: MemoryToolOptions): AgentTool<any> {
  const provider = resolveProvider(options);
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
        path: { type: 'string', description: `Path inside ${VIRTUAL_MEMORY_ROOT}, e.g. ${VIRTUAL_MEMORY_ROOT}/MEMORY.md` },
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
            const target = typeof args.path === 'string' ? args.path : VIRTUAL_MEMORY_ROOT;
            const vr = args.view_range;
            const range = Array.isArray(vr) && vr.length === 2
              && Number.isInteger(Number(vr[0])) && Number.isInteger(Number(vr[1]))
              ? [Number(vr[0]), Number(vr[1])] as [number, number]
              : undefined;
            const result = await provider.read({ path: target }, range);
            if (!result.ok) return resultError(result);
            return textResult(truncateText(result.text), { ok: true, kind: result.kind });
          }
          case 'create': {
            if (typeof args.file_text !== 'string') return errorResult('invalid_params', 'create requires file_text');
            const result = await provider.create({ path: String(args.path ?? '') }, args.file_text);
            if (!result.ok) return resultError(result);
            return textResult(`Created ${String(args.path)}`, { ok: true });
          }
          case 'str_replace': {
            if (typeof args.old_str !== 'string' || typeof args.new_str !== 'string') {
              return errorResult('invalid_params', 'str_replace requires old_str and new_str');
            }
            const result = await provider.replace({ path: String(args.path ?? '') }, args.old_str, args.new_str);
            if (!result.ok) return resultError(result);
            return textResult(`Replaced text in ${String(args.path)}`, { ok: true });
          }
          case 'insert': {
            const line = Number(args.insert_line);
            if (!Number.isInteger(line) || line < 0 || typeof args.insert_text !== 'string') {
              return errorResult('invalid_params', 'insert requires insert_line (>= 0) and insert_text');
            }
            const result = await provider.insert({ path: String(args.path ?? '') }, line, args.insert_text);
            if (!result.ok) return resultError(result);
            return textResult(`Inserted text at line ${line} in ${String(args.path)}`, { ok: true });
          }
          case 'delete': {
            const result = await provider.delete({ path: String(args.path ?? '') });
            if (!result.ok) return resultError(result);
            return textResult(`Deleted ${String(args.path)}`, { ok: true });
          }
          case 'rename': {
            const result = await provider.rename({ path: String(args.old_path ?? '') }, { path: String(args.new_path ?? '') });
            if (!result.ok) return resultError(result);
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
