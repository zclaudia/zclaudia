#!/usr/bin/env node
/**
 * Run test files one by one and summarize the results.
 * Usage: node test-file-by-file.mjs [--allow-external] <path-or-glob>
 * Example: node test-file-by-file.mjs "apps/desktop/src/stores"
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cwd = process.cwd();

function printUsage() {
  console.log('Usage: node test-file-by-file.mjs [--allow-external] <test-directory-or-glob>');
  console.log('Example:');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/stores"');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/services"');
  console.log('  node test-file-by-file.mjs "server/src/routes"');
  console.log('  node test-file-by-file.mjs --allow-external "../zclaudia-gateway/src"');
}

function fail(message) {
  console.log(`Error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const allowExternal = args.includes('--allow-external');
const unknownFlags = args.filter(arg => arg.startsWith('--') && arg !== '--allow-external');
const positional = args.filter(arg => !arg.startsWith('--'));

if (unknownFlags.length > 0) {
  fail(`Unknown flags: ${unknownFlags.join(', ')}`);
}

if (positional.length !== 1) {
  printUsage();
  process.exit(1);
}

const testPath = positional[0];
const absoluteInputPath = path.resolve(cwd, testPath);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isInsidePath(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function hasGlob(value) {
  return /[*?[\]{}]/.test(value);
}

function globToRegExp(pattern) {
  const normalized = toPosix(path.resolve(cwd, pattern));
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function staticBaseForInput(inputPath) {
  if (!hasGlob(inputPath)) return path.resolve(cwd, inputPath);

  const absolute = path.resolve(cwd, inputPath);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep);
  const baseSegments = [];

  for (const segment of segments) {
    if (hasGlob(segment)) break;
    baseSegments.push(segment);
  }

  return path.join(parsed.root, ...baseSegments);
}

function walkFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const stats = statSync(rootPath);
  if (stats.isFile()) return [rootPath];
  if (!stats.isDirectory()) return [];

  const files = [];
  const entries = readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function findTestFiles(inputPath) {
  const basePath = staticBaseForInput(inputPath);
  const matcher = hasGlob(inputPath) ? globToRegExp(inputPath) : null;
  return walkFiles(basePath)
    .filter(file => {
      const normalized = toPosix(file);
      return matcher ? matcher.test(normalized) : true;
    })
    .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.tsx'))
    .filter(file => !file.includes(`${path.sep}node_modules${path.sep}`))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function detectModule(inputPath) {
  const desktopRoot = path.join(repoRoot, 'apps/desktop');
  const serverRoot = path.join(repoRoot, 'server');
  const gatewayRoot = path.resolve(repoRoot, '../zclaudia-gateway');

  if (isInsidePath(inputPath, desktopRoot)) {
    return { moduleDir: desktopRoot, moduleName: 'desktop' };
  }

  if (isInsidePath(inputPath, serverRoot)) {
    return { moduleDir: serverRoot, moduleName: 'server' };
  }

  if (isInsidePath(inputPath, gatewayRoot)) {
    if (!allowExternal) {
      fail('Out-of-repo tests require the --allow-external flag');
    }
    return { moduleDir: gatewayRoot, moduleName: 'gateway' };
  }

  fail('Cannot resolve module path. Supported modules: apps/desktop, server. Use --allow-external for out-of-repo paths.');
}

function selectDesktopConfig(relativePath) {
  if (relativePath.includes('/stores/') || relativePath.includes('/utils/')) {
    return 'vitest.unit.config.ts';
  }

  if (
    relativePath.includes('/hooks/') &&
    !relativePath.includes('useSwipeBack') &&
    !relativePath.includes('useMediaQuery') &&
    !relativePath.includes('useEmbeddedServer') &&
    !relativePath.includes('useGatewayConnection') &&
    !relativePath.includes('useMultiServerSocket')
  ) {
    return 'vitest.unit.config.ts';
  }

  if (relativePath.includes('/components/')) {
    return 'vitest.components.config.ts';
  }

  return 'vitest.coverage.config.ts';
}

function runVitestFile(moduleName, moduleDir, file) {
  const relPath = toPosix(path.relative(moduleDir, file));
  const args = [
    path.join(repoRoot, 'scripts/with-project-node.sh'),
    'pnpm',
    '--dir',
    moduleDir,
    'exec',
    'vitest',
    'run',
    relPath,
  ];

  if (moduleName === 'desktop') {
    args.push('--config', selectDesktopConfig(`/${relPath}`));
  }

  const result = spawnSync('bash', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const moduleInfo = detectModule(absoluteInputPath);
const moduleDirDisplay = toPosix(path.relative(cwd, moduleInfo.moduleDir) || '.');
const files = findTestFiles(testPath).filter(file => isInsidePath(file, moduleInfo.moduleDir));

console.log(`Module: ${moduleInfo.moduleName}`);
console.log(`Path: ${testPath}`);
console.log('');

if (files.length === 0) {
  console.log('No test files found');
  process.exit(1);
}

console.log(`Found ${files.length} test files\n`);

const results = {
  passed: [],
  failed: [],
  skipped: [],
};

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const fileName = path.basename(file);
  const progress = `[${String(i + 1).padStart(String(files.length).length)}/${files.length}]`;

  process.stdout.write(`${progress} ${fileName.padEnd(35)} `);

  const { status, output } = runVitestFile(moduleInfo.moduleName, moduleInfo.moduleDir, file);
  const ansiEscape = String.fromCharCode(27);
  const cleanOutput = output.replace(new RegExp(`${ansiEscape}\\[[0-9;]*[a-zA-Z]`, 'g'), '');
  const passedMatch = cleanOutput.match(/Tests\s+(\d+)\s+passed/);
  const failedMatch = cleanOutput.match(/(\d+)\s+failed/);
  const testCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;

  if (status === 0 && failedCount === 0 && testCount > 0) {
    console.log(`✓ ${testCount} passed`);
    results.passed.push({ file, testCount });
  } else if (failedCount > 0 || cleanOutput.includes('failed')) {
    console.log(`✗ ${failedCount || '?'} failed`);
    results.failed.push({ file, testCount, failedCount, output });
  } else if (cleanOutput.includes('empty') || cleanOutput.includes('no tests') || testCount === 0) {
    console.log('? empty');
    results.skipped.push({ file, reason: 'empty test file' });
  } else {
    console.log('? error');
    results.skipped.push({ file, reason: 'execution error', error: cleanOutput.substring(0, 100) });
  }
}

console.log('\n' + '='.repeat(75));
console.log('📊 Test summary');
console.log('='.repeat(75));

const totalTests = results.passed.reduce((sum, r) => sum + r.testCount, 0);
const totalFailed = results.failed.reduce((sum, r) => sum + (r.failedCount || 0), 0);
const totalPassed = results.passed.length;
const totalFiles = files.length;
const passRate = ((totalPassed / totalFiles) * 100).toFixed(1);

console.log(`
┌──────────────────────────────────────────────────────────────────────────┐
│  Module: ${moduleInfo.moduleName.padEnd(65)}│
│  Path: ${testPath.padEnd(65)}│
│  Workdir: ${moduleDirDisplay.padEnd(57)}│
├──────────────────────────────────────────────────────────────────────────┤
│  Files: ${String(totalFiles).padEnd(61)}│
│  ✅ Passed: ${String(totalPassed).padEnd(61)}│
│  ❌ Failed: ${String(results.failed.length).padEnd(61)}│
│  ⚠️  Skipped: ${String(results.skipped.length).padEnd(61)}│
├──────────────────────────────────────────────────────────────────────────┤
│  Tests passed: ${String(totalTests).padEnd(59)}│
│  Tests failed: ${String(totalFailed).padEnd(59)}│
│  File pass rate: ${String(passRate + '%').padEnd(59)}│
└──────────────────────────────────────────────────────────────────────────┘
`);

if (results.failed.length > 0) {
  console.log('❌ Failed files:');
  console.log('-'.repeat(75));
  results.failed.forEach(({ file, failedCount, testCount }, idx) => {
    console.log(`  ${idx + 1}. ${toPosix(path.relative(cwd, file))}`);
    console.log(`     ${testCount || 0} passed, ${failedCount || '?'} failed`);
  });
  console.log('');
}

if (results.skipped.length > 0) {
  console.log('⚠️  Skipped files:');
  console.log('-'.repeat(75));
  results.skipped.forEach(({ file, reason }, idx) => {
    console.log(`  ${idx + 1}. ${toPosix(path.relative(cwd, file))} (${reason})`);
  });
  console.log('');
}

console.log('='.repeat(75));
console.log('✅ Passed files (sorted by test count):');
console.log('='.repeat(75));

results.passed
  .sort((a, b) => b.testCount - a.testCount)
  .forEach(({ file, testCount }, index) => {
    const num = String(index + 1).padStart(3);
    const count = String(testCount).padStart(3);
    const fileName = path.basename(file);
    console.log(`  ${num}. ${fileName.padEnd(35)} ${count} tests`);
  });

console.log('\n');

process.exit(results.failed.length > 0 ? 1 : 0);
