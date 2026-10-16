// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/third-party-notices.mjs (Apache-2.0)
//
// THIRD-PARTY-NOTICES.md 的读取与新鲜度校验，以及 third-party/inventory.json 的结构校验。
// 与 ZCode 原版的差异：
// - zclaudia 的 third-party/inventory.json 是人工维护的登记文件（reviewRequired 复核结论、
//   copiedComponents 搬入源码），不是生成产物，因此新鲜度不靠 inventory 内的输入哈希校验，
//   而是比对生成文件尾部的机器可读清单（见 generate-third-party-notices.mjs）。
// - 原版的 Node/Electron/原生搜索工具声明 staging 不适用于本仓库，未移植。
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const repositoryRoot = resolve(import.meta.dirname, '../..');
export const noticesFileName = 'THIRD-PARTY-NOTICES.md';

// 生成文件尾部的机器可读清单标记；check 用它判断声明是否覆盖当前生产依赖。
export const MANIFEST_HEADER = '<!-- zclaudia-licenses-manifest';
export const MANIFEST_FOOTER = '-->';

export async function readThirdPartyNotices(root = repositoryRoot) {
  // 开发和构建只消费已有声明；输入新鲜度由显式 license 检查负责。
  return readFile(resolve(root, noticesFileName));
}

// 校验人工维护的登记文件结构：schemaVersion、reviewRequired 复核结论、copiedComponents 搬入源码。
export function validateInventory(inventory) {
  if (inventory?.schemaVersion !== 1) throw new Error('Unsupported third-party inventory');
  for (const field of ['reviewRequired', 'copiedComponents']) {
    if (!Array.isArray(inventory[field]))
      throw new Error(`third-party/inventory.json missing ${field} array`);
  }
  for (const entry of inventory.reviewRequired) {
    if (!entry.id || !entry.bucket || !entry.reason)
      throw new Error(
        `third-party/inventory.json reviewRequired entry needs id/bucket/reason: ${JSON.stringify(entry)}`
      );
  }
  for (const component of inventory.copiedComponents) {
    for (const field of ['id', 'license', 'source', 'copyright', 'importedAt']) {
      if (!component[field])
        throw new Error(
          `third-party/inventory.json copiedComponents entry needs ${field}: ${component.id ?? JSON.stringify(component)}`
        );
    }
    if (!Array.isArray(component.roots) || !component.roots.length)
      throw new Error(
        `third-party/inventory.json copiedComponents entry needs roots: ${component.id}`
      );
  }
}

// 解析生成文件尾部的清单：{ schemaVersion, packages: ["name@version", ...] }。
export function parseNoticesManifest(bytes) {
  const text = bytes.toString('utf8');
  const start = text.indexOf(MANIFEST_HEADER);
  const end = text.indexOf(MANIFEST_FOOTER, start);
  if (start === -1 || end === -1) return null;
  try {
    const manifest = JSON.parse(text.slice(start + MANIFEST_HEADER.length, end).trim());
    return Array.isArray(manifest.packages) ? manifest : null;
  } catch {
    return null;
  }
}

// 校验登记文件结构，并对照当前生产依赖判断 THIRD-PARTY-NOTICES.md 是否存在且覆盖当前图。
// 基础检查只告警（声明是按需生成的产物，不入库）；--strict 下缺失或过期即失败。
export async function readVerifiedNotices(
  root = repositoryRoot,
  { requireComplete = false, requiredPackages = new Set() } = {}
) {
  validateInventory(
    JSON.parse(await readFile(resolve(root, 'third-party/inventory.json'), 'utf8'))
  );
  let bytes;
  try {
    bytes = await readThirdPartyNotices(root);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const message = 'THIRD-PARTY-NOTICES.md 尚未生成；运行 node scripts/licenses.mjs notices';
    if (requireComplete) throw new Error(message, { cause: error });
    return { present: false, stale: [], message };
  }
  const manifest = parseNoticesManifest(bytes);
  if (!manifest)
    throw new Error(
      'THIRD-PARTY-NOTICES.md 缺少机器可读清单；重新运行 node scripts/licenses.mjs notices'
    );
  const listed = new Set(manifest.packages);
  const stale = [...new Set([...listed, ...requiredPackages])]
    .filter(key => listed.has(key) !== requiredPackages.has(key))
    .sort();
  const message = stale.length
    ? `THIRD-PARTY-NOTICES.md 与当前生产依赖相差 ${stale.length} 项；运行 node scripts/licenses.mjs notices 重新生成`
    : null;
  if (requireComplete && message) throw new Error(message);
  return { present: true, stale, message };
}
