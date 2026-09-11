import type { FileChangeEffectFile, ToolEffect } from '@zclaudia/plugin-sdk/types';
import { cleanEffectPath, makeFileChangeEffect } from '@zclaudia/agent-common';

export { cleanEffectPath, makeFileChangeEffect, makeShellEffect } from '@zclaudia/agent-common';

export function fileChangeEffectFromMap(value: unknown): ToolEffect | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, any>;
  const files: FileChangeEffectFile[] = [];

  for (const [rawPath, change] of Object.entries(record)) {
    const path = cleanEffectPath(rawPath);
    if (!path) continue;

    const type = (change?.type as string | undefined)?.toLowerCase();

    let changeKind: FileChangeEffectFile['changeKind'];
    if (type === 'add') {
      changeKind = 'add';
    } else if (type === 'delete') {
      changeKind = 'delete';
    } else {
      changeKind = 'modify';
    }

    files.push({
      path,
      changeKind,
    });
  }

  return makeFileChangeEffect(files);
}

export function fileChangeEffectFromChanges(value: unknown): ToolEffect | undefined {
  if (!Array.isArray(value)) return undefined;
  const files: FileChangeEffectFile[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const change = candidate as Record<string, unknown>;
    const path = cleanEffectPath(typeof change.path === 'string' ? change.path : undefined);
    if (!path) continue;
    const kind =
      change.kind && typeof change.kind === 'object' && !Array.isArray(change.kind)
        ? (change.kind as Record<string, unknown>)
        : undefined;
    const type = typeof kind?.type === 'string' ? kind.type : undefined;
    files.push({
      path,
      changeKind: type === 'add' ? 'add' : type === 'delete' ? 'delete' : 'modify',
    });
    const movePath = cleanEffectPath(
      type === 'update' && typeof kind?.move_path === 'string' ? kind.move_path : undefined
    );
    if (movePath && movePath !== path) files.push({ path: movePath, changeKind: 'modify' });
  }
  return makeFileChangeEffect(files);
}
