import type { RuntimeUsageRuntimeRow } from '@zclaudia/shared/core/usage-stats';

const RUNTIME_LABEL_FALLBACK: Record<string, string> = {
  pi: 'Pi',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  legacy: 'Legacy (unknown source)',
};

export function runtimeLabel(row: RuntimeUsageRuntimeRow): string {
  return row.runtimeLabel ?? RUNTIME_LABEL_FALLBACK[row.runtimeId] ?? row.runtimeId;
}
