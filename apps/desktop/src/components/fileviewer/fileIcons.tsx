import {
  File,
  FileCode2,
  FileCog,
  FileJson,
  FileLock2,
  FileText,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

function fileNameAndExt(pathOrName: string) {
  const fileName = pathOrName.split('/').pop()?.toLowerCase() ?? pathOrName.toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  return { fileName, ext };
}

export function iconForFile(pathOrName: string): LucideIcon {
  const { fileName, ext } = fileNameAndExt(pathOrName);

  if (fileName === 'package.json' || fileName.endsWith('.config.js') || fileName.endsWith('.config.ts') || fileName.endsWith('.config.mjs')) {
    return FileCog;
  }
  if (fileName.includes('lock') || fileName === 'license') return FileLock2;
  if (ext === 'md' || ext === 'mdx' || fileName === 'readme') return ScrollText;
  if (ext === 'json' || ext === 'jsonc') return FileJson;
  if (['ts', 'tsx', 'js', 'jsx', 'css', 'scss', 'html', 'xml', 'svg', 'rs', 'go', 'py', 'sh', 'yml', 'yaml', 'toml'].includes(ext)) {
    return FileCode2;
  }
  if (['txt', 'log'].includes(ext)) return FileText;

  return File;
}
