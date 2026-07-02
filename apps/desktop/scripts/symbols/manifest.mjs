// Manifest for gen:symbols. Icon artwork comes from
// https://github.com/miguelsolorio/vscode-symbols (MIT © Miguel Solorio),
// pinned to a commit so regeneration is deterministic.
export const UPSTREAM_SHA = '296ef1b62287fb2315cb5651e552e09e8c8e1de8';

// Upstream names under src/icons/files/<name>.svg.
// Deliberately excluded: bun (multi-color mascot), next (gradient),
// editorconfig (pastel multi-tone) — their files fall back to other symbols.
export const ICONS = [
  // languages
  'ts',
  'react-ts',
  'js',
  'react',
  'python',
  'go',
  'rust',
  'ruby',
  'php',
  'java',
  'kotlin',
  'swift',
  'c',
  'cplus',
  'h',
  'csharp',
  'database',
  'shell',
  'lua',
  'dart',
  'scala',
  'elixir',
  'erlang',
  'haskell',
  'zig',
  // web
  'code-orange',
  'brackets-purple',
  'sass',
  'vue',
  'svelte',
  'astro',
  // data / config / tooling
  'brackets-yellow',
  'yaml',
  'gear',
  'xml',
  'csv',
  'lock',
  'prettier',
  'eslint',
  'vite',
  'vitest',
  'jest',
  'tailwind',
  'tsconfig',
  'docker',
  'git',
  'github',
  'terraform',
  'graphql',
  'proto',
  'notebook',
  'tauri',
  'node',
  'npm',
  'pnpm',
  'yarn',
  // docs
  'markdown',
  'mdx',
  'text',
  'document',
  'pdf',
  'license',
  'claude',
  // assets
  'image',
  'gif',
  'svg',
  'font',
  'audio',
  'video',
  'compressed',
  // generic fallback shapes
  'code-gray',
  'brackets-gray',
];

// Every visible fill/stroke hex in the chosen set → glyph slot.
// transformSvg throws on any hex missing here (uppercase lookup).
// Slot names must match the glyph-* keys in ../tokens/config.mjs.
export const COLOR_MAP = {
  // grays (incl. dark secondary tones in two-tone icons: vue, dart, scala, svg)
  '#64748B': 'gray',
  '#71717A': 'gray',
  '#52525B': 'gray',
  '#334155': 'gray',
  '#075985': 'gray',
  '#7F1D1D': 'gray',
  // blues
  '#60A5FA': 'blue',
  '#2563EB': 'blue',
  // teals / skies
  '#14B8A6': 'teal',
  '#2DD4BF': 'teal',
  '#38BDF8': 'teal',
  '#0EA5E9': 'teal',
  '#0891B2': 'teal',
  // oranges (D97656 is the claude terracotta)
  '#EA580C': 'orange',
  '#D97656': 'orange',
  // ambers
  '#F59E0B': 'amber',
  '#FBBF24': 'amber',
  '#EAB308': 'amber',
  // green
  '#16A34A': 'green',
  // purples (incl. eslint indigo)
  '#A855F7': 'purple',
  '#C084FC': 'purple',
  '#8B5CF6': 'purple',
  '#A78BFA': 'purple',
  '#4F46E5': 'purple',
  '#A5B4FC': 'purple',
  // pink / red
  '#F472B6': 'pink',
  '#F87171': 'red',
};
