import type { FileChangeEffectFile, ToolEffect } from '@zclaudia/shared/core/message';

export function makeShellEffect(command: string | undefined): ToolEffect | undefined {
  const trimmed = command?.trim();
  return trimmed ? { kind: 'shell', command: trimmed } : undefined;
}

export function makeFileChangeEffect(files: FileChangeEffectFile[]): ToolEffect | undefined {
  const normalized = files
    .map(f => ({ ...f, path: (f.path ?? '').trim(), changeKind: f.changeKind ?? ('unknown' as const) }))
    .filter(f => f.path);
  return normalized.length > 0 ? { kind: 'file_change', files: normalized } : undefined;
}

export function fileChangeEffectFromInput(
  input: unknown,
  changeKind: FileChangeEffectFile['changeKind'] = 'unknown'
): ToolEffect | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const path =
    (typeof record.path === 'string' && record.path) ||
    (typeof record.file_path === 'string' && record.file_path) ||
    undefined;
  if (!path) return undefined;
  return makeFileChangeEffect([{ path, changeKind }]);
}

export function readCursorEditResultEffect(args: unknown, result: unknown): ToolEffect | undefined {
  const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : undefined;
  const success = resultRecord?.success && typeof resultRecord.success === 'object' && !Array.isArray(resultRecord.success)
    ? resultRecord.success as Record<string, unknown>
    : undefined;
  const diffString = typeof success?.diffString === 'string' ? success.diffString : undefined;
  if (diffString) {
    const path = typeof success?.path === 'string'
      ? success.path
      : args && typeof args === 'object' && !Array.isArray(args) && typeof (args as Record<string, unknown>).path === 'string'
        ? (args as Record<string, unknown>).path as string
        : undefined;
    if (path) {
      return makeFileChangeEffect([{ path, changeKind: 'modify', summary: diffString }]);
    }
  }
  return fileChangeEffectFromInput(args, 'modify');
}
