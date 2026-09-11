import type { FileChangeEffectFile, ToolEffect } from '@zclaudia/plugin-sdk/types';
import { makeFileChangeEffect } from '@zclaudia/agent-common';

export { makeFileChangeEffect, makeShellEffect } from '@zclaudia/agent-common';

const DEFAULT_PATH_KEYS = [
  'file_path',
  'notebook_path',
  'path',
  'file',
  'filename',
  'target_file',
  'targetFile',
  'relative_path',
  'relativePath',
  'absolute_path',
  'absolutePath',
] as const;

function filePathFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of DEFAULT_PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

export function fileChangeEffectFromInput(
  input: unknown,
  changeKind: FileChangeEffectFile['changeKind'] = 'unknown'
): ToolEffect | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const path = filePathFromRecord(input as Record<string, unknown>);
  if (!path) return undefined;
  return makeFileChangeEffect([{ path, changeKind }]);
}

export function readCursorEditResultEffect(args: unknown, result: unknown): ToolEffect | undefined {
  const resultRecord =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : undefined;
  const success =
    resultRecord?.success &&
    typeof resultRecord.success === 'object' &&
    !Array.isArray(resultRecord.success)
      ? (resultRecord.success as Record<string, unknown>)
      : undefined;
  const diffString = typeof success?.diffString === 'string' ? success.diffString : undefined;
  if (diffString) {
    const path = success
      ? filePathFromRecord(success)
      : args && typeof args === 'object' && !Array.isArray(args)
        ? filePathFromRecord(args as Record<string, unknown>)
        : undefined;
    if (path) {
      return makeFileChangeEffect([{ path, changeKind: 'modify', summary: diffString }]);
    }
  }
  return fileChangeEffectFromInput(args, 'modify');
}
