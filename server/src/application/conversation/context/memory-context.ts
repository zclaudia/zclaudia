import * as fs from 'fs';
import * as path from 'path';

export const MAX_INDEX_LINES = 200;
export const MAX_INDEX_BYTES = 25 * 1024;

/**
 * Read <memoryDir>/MEMORY.md and wrap it for system-prompt injection.
 * Returns undefined when the index is missing or empty — the Memory tool's
 * own description carries bootstrap guidance, so silence is fine here.
 * Output is deterministic for unchanged index content (prompt-cache safe).
 */
export function buildMemoryContext(memoryDir: string): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8');
  } catch {
    return undefined;
  }
  let index = raw.trim();
  if (!index) return undefined;

  let truncated = false;
  const lines = index.split('\n');
  if (lines.length > MAX_INDEX_LINES) {
    index = lines.slice(0, MAX_INDEX_LINES).join('\n');
    truncated = true;
  }
  if (Buffer.byteLength(index, 'utf8') > MAX_INDEX_BYTES) {
    index = Buffer.from(index, 'utf8').subarray(0, MAX_INDEX_BYTES).toString('utf8');
    truncated = true;
  }
  if (truncated) index += '\n[index truncated — use the Memory tool to view the full MEMORY.md and prune stale entries]';

  return [
    '# Persistent project memory',
    '',
    'You have project memory from previous sessions, maintained via the Memory tool (mounted at /memories). Below is the index (MEMORY.md). Read individual memory files with the Memory tool when an entry looks relevant. Keep the index and files up to date: record user corrections, project decisions, and hard-won lessons; update or delete stale entries instead of duplicating.',
    '',
    '## MEMORY.md',
    '',
    index,
  ].join('\n');
}
