#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

function git(args, options = {}) {
  return execFileSync('git', args, {
    ...options,
    encoding: options.encoding ?? 'utf8',
  });
}

function stagedPathBuffer() {
  return git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
    encoding: 'buffer',
  });
}

function nulSplit(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .map(path => path.trim())
    .filter(Boolean);
}

function ignoredStagedPaths(staged) {
  if (staged.length === 0) return [];

  const result = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
    input: staged,
    encoding: 'buffer',
  });

  if (result.status === 1) return [];
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8').trim();
    throw new Error(stderr || 'git check-ignore failed');
  }

  return nulSplit(result.stdout);
}

try {
  const ignored = ignoredStagedPaths(stagedPathBuffer());

  if (ignored.length > 0) {
    console.error('Ignored staged file(s) detected. Refusing commit:');
    for (const file of ignored) {
      console.error(`  - ${file}`);
    }
    console.error('');
    console.error('These paths match .gitignore. Remove them from the index, or explicitly');
    console.error('ask to force-add them if that is truly intended.');
    process.exit(1);
  }
} catch (error) {
  console.error(`pre-commit guard failed: ${error.message}`);
  process.exit(1);
}
