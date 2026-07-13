#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.ZCLAUDIA_REPO_ROOT || path.resolve(scriptDir, '../..');
const beginMarker = '# BEGIN ZCLAUDIA PRE-COMMIT GUARD';
const endMarker = '# END ZCLAUDIA PRE-COMMIT GUARD';

function git(args) {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function guardBlock() {
  const guardScript = path.join(repoRoot, 'scripts/hooks/pre-commit-guard.mjs');
  return [
    beginMarker,
    `node ${shellQuote(guardScript)}`,
    'guard_status=$?',
    'if [ "$guard_status" -ne 0 ]; then',
    '  exit "$guard_status"',
    'fi',
    endMarker,
  ].join('\n');
}

function installHook() {
  let hookPath;
  try {
    hookPath = git(['rev-parse', '--git-path', 'hooks/pre-commit']);
  } catch {
    console.log('Git hooks not installed: not inside a git worktree.');
    return;
  }

  const absoluteHookPath = path.resolve(process.cwd(), hookPath);
  const block = guardBlock();
  const existing = existsSync(absoluteHookPath) ? readFileSync(absoluteHookPath, 'utf8') : '';

  let next;
  if (!existing.trim()) {
    next = `#!/usr/bin/env sh\n${block}\n`;
  } else if (existing.includes(beginMarker) && existing.includes(endMarker)) {
    const pattern = new RegExp(`${beginMarker}[\\s\\S]*?${endMarker}`);
    next = existing.replace(pattern, block);
  } else {
    next = `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
  }

  writeFileSync(absoluteHookPath, next);
  chmodSync(absoluteHookPath, 0o755);
  console.log(`Installed pre-commit guard: ${absoluteHookPath}`);
}

installHook();
