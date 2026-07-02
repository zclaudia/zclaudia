import {
  File,
  FileCode,
  FileJson,
  FileText,
  Image,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from '../ui/Icon';

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'py',
  'go',
  'sh',
  'bash',
  'zsh',
  'c',
  'h',
  'cpp',
  'hpp',
  'java',
  'kt',
  'swift',
  'rb',
  'php',
  'sql',
  'css',
  'scss',
  'less',
  'html',
  'vue',
  'svelte',
  'ps1',
]);
const TEXT_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rtf', 'log']);
const DATA_EXTENSIONS = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'lock', 'plist']);
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'bmp',
  'avif',
]);
const TEXT_BASENAMES = new Set([
  'license',
  'readme',
  'changelog',
  'contributing',
  'authors',
  'notice',
]);
const CODE_BASENAMES = new Set(['dockerfile', 'makefile', 'justfile', 'rakefile']);

// Exported alongside FileTypeIcon so callers/tests can assert on the mapping
// directly; this file intentionally mixes a component export with a plain
// function export, which react-refresh's fast-refresh heuristic flags.
// eslint-disable-next-line react-refresh/only-export-components
export function iconForFileName(name: string): LucideIcon {
  const lower = name.toLowerCase();
  // Dotfiles and *.config.* are configuration regardless of extension.
  if (lower.startsWith('.') || lower.includes('.config.')) return Settings2;

  const dot = lower.lastIndexOf('.');
  const base = dot > 0 ? lower.slice(0, dot) : lower;
  const ext = dot > 0 ? lower.slice(dot + 1) : '';

  if (CODE_BASENAMES.has(base) || CODE_BASENAMES.has(lower)) return FileCode;
  if (TEXT_BASENAMES.has(base) || TEXT_BASENAMES.has(lower)) return FileText;
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (TEXT_EXTENSIONS.has(ext)) return FileText;
  if (DATA_EXTENSIONS.has(ext)) return FileJson;
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  return File;
}

/**
 * Monochrome lucide file-type icon. Sizing comes from the caller's
 * `[&>svg]:h-3.5 [&>svg]:w-3.5` className; color is always muted per
 * docs/ui-conventions.md (icons in chrome carry no decorative color).
 */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={className}>
      <Icon icon={iconForFileName(name)} strokeWidth={1.75} className="text-muted-foreground" />
    </span>
  );
}
