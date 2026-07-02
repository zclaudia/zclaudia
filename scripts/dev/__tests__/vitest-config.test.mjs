import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const ignoredDirectories = new Set([
  '.claude',
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

function collectVitestConfigs(directory, configs = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectVitestConfigs(path.join(directory, entry.name), configs);
      }
      continue;
    }

    if (/^vitest(?:\.[^.]+)*\.config\.[cm]?[jt]s$/.test(entry.name)) {
      configs.push(path.join(directory, entry.name));
    }
  }

  return configs;
}

test('vitest configs avoid removed and deprecated Vitest 4 options', () => {
  const configs = collectVitestConfigs(repoRoot);
  assert.ok(configs.length > 0, 'expected to find Vitest config files');

  const violations = configs.flatMap(configPath => {
    const relativePath = path.relative(repoRoot, configPath);
    const contents = readFileSync(configPath, 'utf8');
    const configViolations = [];

    if (/\bpoolOptions\s*:/.test(contents)) {
      configViolations.push(
        `${relativePath}: poolOptions was removed; use top-level worker options`
      );
    }

    if (/\bcache\s*:\s*\{[\s\S]*?\bdir\s*:/.test(contents)) {
      configViolations.push(`${relativePath}: test.cache.dir is deprecated; use cacheDir`);
    }

    return configViolations;
  });

  assert.deepEqual(violations, []);
});
