/**
 * 把工作区相对路径换算为相对 docPath 所在目录的引用（设计文档 §5.2）。
 *
 * 纯函数：按 '/' 段求公共前缀，回退 '../' 段数 + 剩余段 join('/')；
 * 不做 URL 编码（与预览 workspacePath 的 decode 逻辑对称，写什么读什么）。
 *
 * 例：docPath 'design/index.html' + asset 'assets/a.png' → '../assets/a.png'；
 * 同目录 'design/a.png' → 'a.png'；doc 在根时直接返回剩余段。
 */
export function relativeAssetRef(docPath: string, assetPath: string): string {
  const docDir = docPath.split('/').slice(0, -1);
  const assetSegments = assetPath.split('/');
  let common = 0;
  while (
    common < docDir.length &&
    common < assetSegments.length - 1 && // 资产最后一段是文件名，不参与目录公共前缀
    docDir[common] === assetSegments[common]
  ) {
    common += 1;
  }
  const ups = Array.from({ length: docDir.length - common }, () => '..');
  return [...ups, ...assetSegments.slice(common)].join('/');
}
