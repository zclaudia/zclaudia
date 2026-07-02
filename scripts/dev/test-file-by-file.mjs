#!/usr/bin/env node
/**
 * 逐个文件运行测试并汇总结果
 * 用法: node test-file-by-file.mjs [--allow-external] <path-or-glob>
 * 示例: node test-file-by-file.mjs "apps/desktop/src/stores"
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
  console.log('用法: node test-file-by-file.mjs [--allow-external] <test-directory-or-glob>');
  console.log('示例:');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/stores"');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/services"');
  console.log('  node test-file-by-file.mjs "server/src/routes"');
  console.log('  node test-file-by-file.mjs --allow-external "../zclaudia-gateway/src"');
}

function fail(message) {
  console.log(`错误: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const allowExternal = args.includes('--allow-external');
const unknownFlags = args.filter(arg => arg.startsWith('--') && arg !== '--allow-external');
const positional = args.filter(arg => !arg.startsWith('--'));

if (unknownFlags.length > 0) {
  fail(`未知参数: ${unknownFlags.join(', ')}`);
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
      fail('外部仓库测试需要显式传入 --allow-external');
    }
    return { moduleDir: gatewayRoot, moduleName: 'gateway' };
  }

  fail('无法识别模块路径。支持的模块: apps/desktop, server。外部仓库需使用 --allow-external。');
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

console.log(`模块: ${moduleInfo.moduleName}`);
console.log(`路径: ${testPath}`);
console.log('');

if (files.length === 0) {
  console.log('未找到测试文件');
  process.exit(1);
}

console.log(`共找到 ${files.length} 个测试文件\n`);

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
console.log('📊 测试结果汇总');
console.log('='.repeat(75));

const totalTests = results.passed.reduce((sum, r) => sum + r.testCount, 0);
const totalFailed = results.failed.reduce((sum, r) => sum + (r.failedCount || 0), 0);
const totalPassed = results.passed.length;
const totalFiles = files.length;
const passRate = ((totalPassed / totalFiles) * 100).toFixed(1);

console.log(`
┌──────────────────────────────────────────────────────────────────────────┐
│  模块: ${moduleInfo.moduleName.padEnd(65)}│
│  路径: ${testPath.padEnd(65)}│
│  运行目录: ${moduleDirDisplay.padEnd(57)}│
├──────────────────────────────────────────────────────────────────────────┤
│  总文件数: ${String(totalFiles).padEnd(61)}│
│  ✅ 通过:   ${String(totalPassed).padEnd(61)}│
│  ❌ 失败:   ${String(results.failed.length).padEnd(61)}│
│  ⚠️  跳过:  ${String(results.skipped.length).padEnd(61)}│
├──────────────────────────────────────────────────────────────────────────┤
│  通过测试数: ${String(totalTests).padEnd(59)}│
│  失败测试数: ${String(totalFailed).padEnd(59)}│
│  文件成功率: ${String(passRate + '%').padEnd(59)}│
└──────────────────────────────────────────────────────────────────────────┘
`);

if (results.failed.length > 0) {
  console.log('❌ 失败的文件:');
  console.log('-'.repeat(75));
  results.failed.forEach(({ file, failedCount, testCount }, idx) => {
    console.log(`  ${idx + 1}. ${toPosix(path.relative(cwd, file))}`);
    console.log(`     ${testCount || 0} passed, ${failedCount || '?'} failed`);
  });
  console.log('');
}

if (results.skipped.length > 0) {
  console.log('⚠️  跳过的文件:');
  console.log('-'.repeat(75));
  results.skipped.forEach(({ file, reason }, idx) => {
    console.log(`  ${idx + 1}. ${toPosix(path.relative(cwd, file))} (${reason})`);
  });
  console.log('');
}

console.log('='.repeat(75));
console.log('✅ 通过的文件列表 (按测试数排序):');
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
