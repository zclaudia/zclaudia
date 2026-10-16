#!/usr/bin/env node
// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/licenses.mjs (Apache-2.0)
//
// 三方 license 盘点/声明/门禁 一体脚本
//
// 用法：
//   node scripts/licenses.mjs notices            生成 THIRD-PARTY-NOTICES.md（生产依赖精确版本、原始许可文本）
//   node scripts/licenses.mjs check [--strict]   手动门禁：allowlist 之外或许可未知退出码 1
//
// 数据口径：
// - 实装清单 = 全 workspace node_modules（含 node_modules/.pnpm 虚拟 store）的递归集合，
//   含嵌套版本与符号链接；prod 判定按 pnpm-lock.yaml 生产图（与实装图做一致性断言）。
// - 声明生成：generate-third-party-notices.mjs 按生产依赖精确版本收集真实许可文件。
// - 商用/半开放检查作用于全量实装包（prod+dev）。
//
// 与 ZCode 原版的口径差异：
// - 许可标识分类表（GREEN 正则与 classify）移植自 ZCode scripts/licenses.mjs；zclaudia 扩展：
//   OFL-1.0/1.1（SIL 开源字体许可，允许随软件捆绑分发）计入 green；人工核实的
//   Anthropic 专有运行时标识单列 review-proprietary。
// - ZCode 把复核结论内联在脚本数组（WEAK_ALLOW/PROD_REVIEWED）；本仓库改在
//   third-party/inventory.json 的 reviewRequired 登记（id 支持 `*` 结尾前缀匹配），
//   yellow / review-proprietary 命中登记结论后放行，missing/unresolved/red 一律阻断。
// - THIRD-PARTY-NOTICES.md 是生成产物不入库；check 基础模式只对声明缺失/过期告警，
//   `--strict`（发布前）转为失败。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateThirdPartyNotices } from './licenses/generate-third-party-notices.mjs';
import { readVerifiedNotices, validateInventory } from './licenses/third-party-notices.mjs';
import {
  missingProductionPackages,
  readWorkspaceProductionGraph,
  scanInstalledPackages,
} from './licenses/third-party-npm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'notices';
if (command === 'notices') {
  await generateThirdPartyNotices(ROOT);
  process.exit(0);
}

// 标识门禁与声明生成共用 workspace 图和递归扫描，不按包名猜测生产范围。
const { required, projects } = await readWorkspaceProductionGraph(ROOT);
const ownNames = new Set(projects.map(project => project.name));
const installed = new Map();
// 包内 license 字段缺失或只写“SEE LICENSE IN …”指针时的人工复核结论
// （逐个打开包内许可文件核实；未安装的平台变体按同族口径推定）。
const MANUAL_LICENSE = {
  'exif-parser': 'MIT', // 包内 LICENSE.md（MIT 全文）
  '@browserbasehq/sdk': 'Apache-2.0', // 包内 LICENSE（Apache-2.0 全文；package.json 未声明字段）
  '@anthropic-ai/claude-agent-sdk': 'Anthropic-Proprietary', // 包内 LICENSE.md
  '@anthropic-ai/claude-agent-sdk-darwin-arm64': 'Anthropic-Proprietary', // 包内 LICENSE.md
  '@anthropic-ai/claude-agent-sdk-darwin-x64': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-linux-arm64': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-linux-x64': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-win32-arm64': 'Anthropic-Proprietary',
  '@anthropic-ai/claude-agent-sdk-win32-x64': 'Anthropic-Proprietary',
};
function normLicense(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normLicense).join(' OR ');
  return value?.type?.trim() || '(missing)';
}
function resolveLicense(pkg) {
  const manual = MANUAL_LICENSE[pkg.name];
  const declared = normLicense(pkg.license ?? pkg.licenses);
  if (manual && (declared === '(missing)' || /^SEE LICEN[CS]E IN/i.test(declared))) return manual;
  return declared;
}
const scanned = await scanInstalledPackages(ROOT, projects);
missingProductionPackages(required, scanned);
for (const [key, { pkg }] of scanned) {
  if (ownNames.has(pkg.name)) continue;
  installed.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: resolveLicense(pkg),
    isProd: required.has(key),
  });
}
// ---------- 分类（标识表参考 ZCode scripts/licenses.mjs 的 green/yellow/red 口径） ----------
const GREEN =
  /^(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|BSD-4-Clause|0BSD|Unlicense|Apache-2\.0|Zlib|WTFPL|Artistic-2\.0|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|CC-BY-3\.0|BSD|Python-2\.0|OFL-1\.0|OFL-1\.1)$/i;
function classify(raw) {
  const s = raw.replace(/[()]/g, ' ').trim();
  if (s === '(missing)' || s === 'missing' || s === '') return 'missing';
  if (/^UNLICENSED|SEE LICEN[CS]E IN|UNKNOWN|N\/A$/i.test(s)) return 'unresolved';
  const or = s
    .split(/\s+OR\s+/i)
    .map(x => x.trim())
    .filter(Boolean);
  if (or.length > 1 && or.some(x => GREEN.test(x))) return 'green';
  const and = s
    .split(/\s+AND\s+/i)
    .map(x => x.trim())
    .filter(Boolean);
  if (and.length > 1 && and.every(x => GREEN.test(x))) return 'green';
  const t = or[0] || and[0] || s;
  if (/\bAGPL/i.test(t)) return 'red-agpl';
  if (/\bLGPL/i.test(t)) return 'yellow-lgpl';
  if (/\bGPL/i.test(t)) return 'red-gpl';
  if (/^(MPL|EPL|CDDL)/i.test(t)) return 'yellow-weak';
  if (/^(BUSL|BSL|Elastic|SSPL|PolyForm|FSL|CAL-1)/i.test(t)) return 'red-semiopen';
  if (/^CC-BY-NC/i.test(t)) return 'red-nc';
  if (/^CC-BY-(ND|SA)/i.test(t)) return 'yellow-cc';
  if (/^Anthropic-Proprietary$/i.test(t)) return 'review-proprietary';
  return GREEN.test(t) ? 'green' : 'review';
}
for (const r of installed.values()) r.bucket = classify(r.license);
// ---------- 复核结论登记（third-party/inventory.json reviewRequired） ----------
// 每条 { id, bucket, reason, date?, decidedBy? }；id 为包名或 `*` 结尾的前缀模式，
// bucket 必须与包的分类一致，许可标识变化后登记自动失效（重新阻断）。
function matchesRegistration(pattern, name) {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

if (command === 'check') {
  const inventory = JSON.parse(
    await readFile(path.join(ROOT, 'third-party/inventory.json'), 'utf8')
  );
  validateInventory(inventory);
  const registered = inventory.reviewRequired;
  const bad = [];
  const registeredHits = new Set();
  for (const r of installed.values()) {
    if (r.bucket === 'green') continue;
    // 黄灯类（LGPL/MPL/EPL/CC 补充条款）与人工核实的专有运行时：登记结论后放行。
    const passable = r.bucket.startsWith('yellow') || r.bucket === 'review-proprietary';
    const hit = passable
      ? registered.findIndex(e => matchesRegistration(e.id, r.name) && e.bucket === r.bucket)
      : -1;
    if (hit !== -1) {
      registeredHits.add(hit);
      continue;
    }
    bad.push(r);
  }
  if (bad.length) {
    console.error(`✗ license 检查失败：${bad.length} 个包超出 allowlist：`);
    for (const r of bad.sort((a, b) => a.name.localeCompare(b.name)))
      console.error(
        `  [${r.bucket}]${r.isProd ? '(prod)' : ''} ${r.name}@${r.version} → ${r.license}`
      );
    console.error(
      '\n处置：替换依赖；yellow / review-proprietary 类可在 third-party/inventory.json 的 reviewRequired 登记人工复核结论（id/bucket/reason）后放行；missing/unresolved/red 必须先补齐许可标识或替换依赖。'
    );
    process.exit(1);
  }
  for (const [index, entry] of registered.entries()) {
    if (!registeredHits.has(index))
      console.warn(
        `⚠ 登记项未命中任何实装包（许可标识变化或依赖已移除，请复核清理）：${entry.id} [${entry.bucket}]`
      );
  }
  const strict = process.argv.includes('--strict');
  const noticeState = await readVerifiedNotices(ROOT, {
    requireComplete: strict,
    requiredPackages: new Set(required.keys()),
  });
  if (noticeState.message) console.warn(`⚠ ${noticeState.message}`);
  if (registered.length)
    console.warn(
      `已登记复核结论 ${registered.length} 项（third-party/inventory.json reviewRequired）；发布前运行 node scripts/licenses.mjs check --strict，不得将基础检查通过视为合规完成。`
    );
  const prodCount = [...installed.values()].filter(r => r.isProd).length;
  console.log(
    `✓ 许可标识检查通过：${installed.size} 个实装包（生产图 ${prodCount} 个；登记复核 ${registered.length} 项）。${noticeState.present ? '声明文件已生成。' : '声明文件尚未生成，按需运行 node scripts/licenses.mjs notices。'}`
  );
} else {
  console.error('用法: node scripts/licenses.mjs [notices|check]');
  process.exit(2);
}
