/**
 * Inspector 分区矩阵（P3 §2.3 分组表单）：分区 id、渲染顺序、默认展开态，
 * 以及「分区 × 标签名」的可见性判定。纯数据 + 纯函数，供 SelectionEditor 折叠面板使用。
 */

export type InspectorSectionId =
  | 'text'
  | 'link'
  | 'image'
  | 'typography'
  | 'fill-border'
  | 'size-spacing'
  | 'structure';

/** 分区渲染顺序：文字 → 链接 → 图片 → 排版 → 填充与边框 → 尺寸与间距 → 结构。 */
export const INSPECTOR_SECTION_ORDER: readonly InspectorSectionId[] = [
  'text',
  'link',
  'image',
  'typography',
  'fill-border',
  'size-spacing',
  'structure',
];

/** 默认展开态：内容分区（文字/链接/图片/排版）默认展开，外观/布局分区默认折叠。 */
export const DEFAULT_SECTION_OPEN: Record<InspectorSectionId, boolean> = {
  text: true,
  link: true,
  image: true,
  typography: true,
  'fill-border': false,
  'size-spacing': false,
  structure: false,
};

/** HTML void 标签全集（无结束标签、不承载文字内容）。 */
export const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * 分区对标签的可见性：文字分区排除 void 标签；链接分区仅 `a`；图片分区仅
 * `img`；排版分区排除 `img`；填充边框、尺寸间距与结构分区恒可见。
 */
export function isSectionVisible(id: InspectorSectionId, tagName: string): boolean {
  switch (id) {
    case 'text':
      return !VOID_TAGS.has(tagName);
    case 'link':
      return tagName === 'a';
    case 'image':
      return tagName === 'img';
    case 'typography':
      return tagName !== 'img';
    case 'fill-border':
    case 'size-spacing':
    case 'structure':
      return true;
  }
}
