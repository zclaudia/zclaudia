import { describe, expect, it } from 'vitest';
import { symbolNameForFile } from '../mapping';

describe('symbolNameForFile', () => {
  it.each([
    // languages
    ['index.ts', 'ts'],
    ['App.tsx', 'react-ts'],
    ['App.TS', 'ts'], // case-insensitive
    ['main.js', 'js'],
    ['runner.mjs', 'js'],
    ['Widget.jsx', 'react'],
    ['build.rs', 'rust'],
    ['main.go', 'go'],
    ['app.py', 'python'],
    ['query.sql', 'database'],
    ['deploy.sh', 'shell'],
    ['windows.ps1', 'shell'],
    // web
    ['index.html', 'code-orange'],
    ['styles.css', 'brackets-purple'],
    ['theme.scss', 'sass'],
    ['App.vue', 'vue'],
    // data & config
    ['data.json', 'brackets-yellow'],
    ['config.yaml', 'yaml'],
    ['config.toml', 'gear'],
    ['feed.xml', 'xml'],
    ['stats.csv', 'csv'],
    // special basenames (before extension rules)
    ['package.json', 'node'],
    ['package-lock.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['pnpm-workspace.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['tauri.conf.json', 'tauri'],
    ['CLAUDE.md', 'claude'],
    ['Dockerfile', 'docker'],
    ['Dockerfile.dev', 'docker'], // prefix looseness is intentional
    ['docker-compose.yml', 'docker'],
    ['Makefile', 'code-gray'],
    ['LICENSE', 'license'],
    ['LICENSE.md', 'license'],
    ['README.md', 'markdown'],
    ['tsconfig.json', 'tsconfig'],
    ['tsconfig.node.json', 'tsconfig'],
    // tool-config prefixes (before the generic dotfile rule)
    ['.prettierrc.json', 'prettier'],
    ['prettier.config.mjs', 'prettier'],
    ['eslint.config.mjs', 'eslint'],
    ['.eslintrc', 'eslint'],
    ['vite.config.ts', 'vite'],
    ['vitest.unit.config.ts', 'vitest'],
    ['tailwind.config.js', 'tailwind'],
    ['.gitignore', 'git'],
    ['.env.local', 'gear'],
    // generic dotfile / config fallback
    ['.syncignore', 'gear'],
    ['.dockerignore', 'gear'], // does not start with "dockerfile"; falls to dotfile rule
    ['playwright.config.ts', 'gear'],
    // docs & assets
    ['notes.txt', 'text'],
    ['CHANGELOG', 'text'],
    ['guide.mdx', 'mdx'],
    ['report.pdf', 'pdf'],
    ['photo.PNG', 'image'],
    ['anim.gif', 'gif'],
    ['logo.svg', 'svg'],
    ['Inter.woff2', 'font'],
    ['song.mp3', 'audio'],
    ['demo.mp4', 'video'],
    ['archive.tar.gz', 'compressed'],
    // fallback
    ['unknown.xyz', 'document'],
    ['no-extension', 'document'],
    ['constructor', 'document'], // prototype-chain hardening
  ])('%s → %s', (name, expected) => {
    expect(symbolNameForFile(name)).toBe(expected);
  });
});
