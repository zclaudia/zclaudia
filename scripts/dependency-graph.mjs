#!/usr/bin/env node
// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/dependency-graph.mjs (Apache-2.0)
//
// 生成全 workspace 的包级依赖图，默认输出到根 dependency-graph.mmd（mermaid，入库可 diff）。
//
// 与 ZCode 原版的适配差异：
// - ZCode 原版输出文件级依赖图（每个源文件一个节点）；第一梯队计划要求包级图，
//   故沿用其 specifier 解析思路（ts.preProcessFile 收集 import），把节点聚合到
//   workspace 包粒度；包内相对引用不产生自环边。
// - workspace 包清单按 pnpm-workspace.yaml 的 globs（apps/*、server、shared、
//   packages/*、plugins/agents/*）枚举，以各包 package.json 的 name（@zclaudia/*）
//   作为节点名；`@zclaudia/` 开头但不匹配 workspace 包的 specifier（如
//   @zclaudia/protocol、@zclaudia/plugin-sdk 等发布包）视为外部依赖，不出边。
// - 原版 import 根 workspace 的 typescript；本仓库根 devDependencies 未直接依赖
//   typescript，改用 ts-morph 自带的 ts 绑定。
// - 代码格式按本仓库 prettier（单引号、100 列）。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ts } from 'ts-morph';

const ROOT = process.cwd();
const DEFAULT_OUTPUT = 'dependency-graph.mmd';
const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.d.mts',
  '.d.cts',
];
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', 'docs', 'build']);

// 与 pnpm-workspace.yaml 的 packages 清单保持一致。
const WORKSPACE_PACKAGE_ROOTS = ['apps/*', 'server', 'shared', 'packages/*', 'plugins/agents/*'];

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    format: 'mermaid',
    direction: 'LR',
    includeIsolated: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    // pnpm run 在透传参数时会保留一个裸 --，这里需要显式跳过，避免把它误当成选项。
    if (arg === '--') {
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.output = argv[index + 1] ?? DEFAULT_OUTPUT;
      index += 1;
      continue;
    }

    if (arg === '--format') {
      options.format = argv[index + 1] ?? 'mermaid';
      index += 1;
      continue;
    }

    if (arg === '--direction') {
      options.direction = argv[index + 1] ?? 'LR';
      index += 1;
      continue;
    }

    if (arg === '--include-isolated') {
      options.includeIsolated = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`未知参数: ${arg}（-h 查看帮助）`);
  }

  if (!['mermaid', 'dot', 'json'].includes(options.format)) {
    throw new Error(`不支持的输出格式: ${options.format}`);
  }

  if (!['LR', 'RL', 'TB', 'TD', 'BT'].includes(options.direction)) {
    throw new Error(`不支持的 Mermaid 方向: ${options.direction}`);
  }

  return options;
}

function printHelp() {
  console.log(`根据 workspace 各包源码的 import 关系生成包级依赖图（节点为 @zclaudia/* 包名）。

用法:
  pnpm dep:graph
  pnpm dep:graph -- --format json -o -
  pnpm dep:graph -- --include-isolated

选项:
  -o, --output <path>         输出文件路径，传 - 表示输出到 stdout（默认 dependency-graph.mmd）
  --format <mermaid|dot|json> 输出格式，默认 mermaid
  --direction <LR|RL|TB|TD|BT> Mermaid 图方向，默认 LR
  --include-isolated          把没有任何依赖边的包也输出出来
  -h, --help                  查看帮助
`);
}

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function listWorkspacePackages() {
  const packages = [];

  for (const packageRoot of WORKSPACE_PACKAGE_ROOTS) {
    const parentDir = path.dirname(packageRoot);
    const candidates = packageRoot.includes('*')
      ? fs
          .readdirSync(path.join(ROOT, parentDir), { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => path.join(parentDir, entry.name))
      : [packageRoot];

    for (const candidate of candidates) {
      const packageRootAbs = path.join(ROOT, candidate);
      const packageJsonPath = path.join(packageRootAbs, 'package.json');
      const srcRoot = path.join(packageRootAbs, 'src');
      if (!fs.existsSync(packageJsonPath) || !fs.existsSync(srcRoot)) {
        continue;
      }
      const packageJson = readJson(packageJsonPath);
      packages.push({ name: packageJson.name, root: packageRootAbs, srcRoot });
    }
  }

  return packages;
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.some(extension => filePath.endsWith(extension));
}

function shouldIgnorePath(filePath) {
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith('..')) {
    return true;
  }

  const segments = relativePath.split(path.sep);
  return segments.some(segment => IGNORE_DIRS.has(segment));
}

function walkCodeFiles(entryPath, bucket) {
  const stats = fs.statSync(entryPath);
  if (stats.isDirectory()) {
    for (const name of fs.readdirSync(entryPath)) {
      const childPath = path.join(entryPath, name);
      if (!shouldIgnorePath(childPath)) {
        walkCodeFiles(childPath, bucket);
      }
    }
    return;
  }

  if (!isCodeFile(entryPath) || shouldIgnorePath(entryPath)) {
    return;
  }

  bucket.push(path.resolve(entryPath));
}

function findOwningPackage(filePath, workspacePackages) {
  return (
    workspacePackages.find(
      pkg => filePath === pkg.root || filePath.startsWith(`${pkg.root}${path.sep}`)
    ) ?? null
  );
}

function collectSpecifiers(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const info = ts.preProcessFile(text, true, true);
  return Array.from(new Set(info.importedFiles.map(item => item.fileName).filter(Boolean)));
}

// 把一个 import specifier 解析成目标 workspace 包；返回 null 表示与本仓库
// workspace 无关（node: 内置、外部 npm 包、未识别路径）。
function resolveTargetPackage(specifier, sourceFile, workspacePackages) {
  if (specifier.startsWith('node:')) {
    return null;
  }

  const sourcePackage = findOwningPackage(sourceFile, workspacePackages);
  if (!sourcePackage) {
    return null;
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // 相对引用：目标落在另一个 workspace 包的 src 内才算跨包边。
    const absoluteTarget = path.resolve(path.dirname(sourceFile), specifier);
    const targetPackage = findOwningPackage(absoluteTarget, workspacePackages);
    return targetPackage === sourcePackage ? null : targetPackage;
  }

  if (specifier.startsWith('@/')) {
    // apps/desktop 的 src 别名，永远指向本包内部。
    return null;
  }

  if (specifier.startsWith('@zclaudia/')) {
    const packageName = specifier.split('/').slice(0, 2).join('/');
    return workspacePackages.find(pkg => pkg.name === packageName) ?? null;
  }

  return null;
}

function formatMermaid(nodes, edges, direction) {
  const ids = new Map(nodes.map((node, index) => [node, `N${index}`]));
  const lines = [`flowchart ${direction}`];

  for (const node of nodes) {
    lines.push(`    ${ids.get(node)}["${node.replaceAll('"', '\\"')}"]`);
  }

  for (const [from, to] of edges) {
    lines.push(`    ${ids.get(from)} --> ${ids.get(to)}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatDot(nodes, edges) {
  const lines = ['digraph dependencies {', '  rankdir="LR";', '  node [shape="box"];'];

  for (const node of nodes) {
    lines.push(`  "${node.replaceAll('"', '\\"')}";`);
  }

  for (const [from, to] of edges) {
    lines.push(`  "${from.replaceAll('"', '\\"')}" -> "${to.replaceAll('"', '\\"')}";`);
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function formatJson(nodes, edges) {
  return `${JSON.stringify(
    {
      nodes,
      edges: edges.map(([from, to]) => ({ from, to })),
    },
    null,
    2
  )}\n`;
}

function writeOutput(outputPath, content) {
  if (outputPath === '-') {
    process.stdout.write(content);
    return;
  }

  const absoluteOutput = path.resolve(ROOT, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, content, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspacePackages = listWorkspacePackages();
  if (workspacePackages.length === 0) {
    throw new Error(
      '未找到任何 workspace 包（检查 pnpm-workspace.yaml 与脚本内 WORKSPACE_PACKAGE_ROOTS）'
    );
  }

  const sourceFiles = [];
  for (const pkg of workspacePackages) {
    walkCodeFiles(pkg.srcRoot, sourceFiles);
  }

  const edges = new Set();
  const nodes = new Set();

  for (const filePath of sourceFiles) {
    const sourcePackage = findOwningPackage(filePath, workspacePackages);
    if (!sourcePackage) {
      continue;
    }

    for (const specifier of collectSpecifiers(filePath)) {
      const targetPackage = resolveTargetPackage(specifier, filePath, workspacePackages);
      if (!targetPackage || targetPackage === sourcePackage) {
        continue;
      }

      nodes.add(sourcePackage.name);
      nodes.add(targetPackage.name);
      edges.add(`${sourcePackage.name}\u0000${targetPackage.name}`);
    }
  }

  if (options.includeIsolated) {
    for (const pkg of workspacePackages) {
      nodes.add(pkg.name);
    }
  }

  const orderedNodes = Array.from(nodes).sort();
  const orderedEdges = Array.from(edges)
    .map(entry => entry.split('\u0000'))
    .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

  const content =
    options.format === 'json'
      ? formatJson(orderedNodes, orderedEdges)
      : options.format === 'dot'
        ? formatDot(orderedNodes, orderedEdges)
        : formatMermaid(orderedNodes, orderedEdges, options.direction);

  writeOutput(options.output, content);

  const destination = options.output === '-' ? 'stdout' : options.output;
  console.error(
    `已生成包级依赖图: ${destination} (packages=${orderedNodes.length}, edges=${orderedEdges.length})`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
