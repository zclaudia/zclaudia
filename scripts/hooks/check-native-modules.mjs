#!/usr/bin/env node
/**
 * Quick ABI compatibility check for native modules.
 *
 * Exits 0 if all native modules load successfully (or aren't installed yet).
 * Exits 1 if any module fails with ERR_DLOPEN_FAILED (ABI mismatch).
 *
 * When pnpm is available, auto-rebuilds only mismatched native modules and
 * verifies that they load afterward. This script should be executed with the
 * same Node runtime that will run the server.
 *
 * Usage (in package.json):
 *   "postinstall": "node scripts/hooks/check-native-modules.mjs"
 */
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const modules = [
  {
    name: 'better-sqlite3',
    check() {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      try {
        db.prepare('select 1 as ok').get();
      } finally {
        db.close();
      }
    },
  },
];

function readPnpmStoreDir() {
  const modulesYaml = path.join(repoRoot, 'node_modules', '.modules.yaml');
  if (!fs.existsSync(modulesYaml)) return null;

  const text = fs.readFileSync(modulesYaml, 'utf8');
  const match = text.match(/^storeDir:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
}

function checkModules() {
  const failed = [];
  const missing = [];

  for (const mod of modules) {
    try {
      mod.check();
    } catch (e) {
      if (e?.code === 'MODULE_NOT_FOUND') {
        missing.push(mod.name);
      } else if (e?.code === 'ERR_DLOPEN_FAILED') {
        failed.push(mod.name);
      } else {
        throw e;
      }
    }
  }

  return { failed, missing };
}

function hasPnpm() {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore', cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

function rebuildModules(failed) {
  const storeDir = readPnpmStoreDir();
  const storeArgs = storeDir ? ['--store-dir', storeDir] : [];

  console.log(
    `\x1b[33m! Native module ABI mismatch for ${failed.join(', ')} under Node ${process.version} (ABI ${process.versions.modules}); rebuilding...\x1b[0m`,
  );
  execFileSync('pnpm', [...storeArgs, 'rebuild', ...failed], { stdio: 'inherit', cwd: repoRoot });
}

const initial = checkModules();

if (initial.missing.length > 0) {
  console.log(`Native module check skipped; not installed yet: ${initial.missing.join(', ')}`);
  process.exit(0);
}

if (initial.failed.length > 0) {
  if (!hasPnpm()) {
    console.error(
      `\x1b[31m✗ Native module ABI mismatch for ${initial.failed.join(', ')} under Node ${process.version} (ABI ${process.versions.modules}), but pnpm is not available.\x1b[0m`,
    );
    console.error(`Run: pnpm rebuild ${initial.failed.join(' ')}`);
    process.exit(1);
  }

  try {
    rebuildModules(initial.failed);
  } catch {
    console.error(`\x1b[31m✗ Failed to rebuild native modules. Try: pnpm rebuild ${initial.failed.join(' ')}\x1b[0m`);
    process.exit(1);
  }

  const after = checkModules();
  if (after.failed.length > 0) {
    console.error(`\x1b[31m✗ Native modules still fail after rebuild: ${after.failed.join(', ')}\x1b[0m`);
    process.exit(1);
  }

  console.log(`\x1b[32m+ Native modules rebuilt for Node ${process.version} (ABI ${process.versions.modules})\x1b[0m`);
}
