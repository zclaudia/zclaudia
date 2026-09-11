import type { FileChangeEffectFile, ToolEffect } from '@zclaudia/plugin-sdk/types';

export const MAX_FILE_CHANGE_EFFECT_FILES = 1000;

export function makeShellEffect(command: string | undefined): ToolEffect | undefined {
  const trimmed = command?.trim();
  return trimmed ? { kind: 'shell', command: trimmed } : undefined;
}

export function cleanEffectPath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  let value = rawPath.trim();
  if (!value || value === '/dev/null') return undefined;
  const tabIndex = value.indexOf('\t');
  if (tabIndex >= 0) value = value.slice(0, tabIndex);
  value = value.replace(/^["']|["']$/g, '');
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  return value || undefined;
}

export function makeFileChangeEffect(files: FileChangeEffectFile[]): ToolEffect | undefined {
  const normalized = files
    .map(file => ({
      ...file,
      path: cleanEffectPath(file.path) ?? '',
      changeKind: file.changeKind ?? ('unknown' as const),
    }))
    .filter(file => file.path)
    .slice(0, MAX_FILE_CHANGE_EFFECT_FILES);
  return normalized.length > 0 ? { kind: 'file_change', files: normalized } : undefined;
}
