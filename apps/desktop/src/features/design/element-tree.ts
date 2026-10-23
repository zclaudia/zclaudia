import type { P5Element, P5ParentNode } from './html/parse';
import { attrValue, childElements, findElement, isTextNode, parseDocument } from './html/parse';

/** 树访问节点数上限（对齐 preview.ts markStaticElements）。 */
const MAX_VISITED_NODES = 10000;
/** 树展开深度上限（对齐 preview.ts markStaticElements）。 */
const MAX_TREE_DEPTH = 128;
/** 桥接 select-path 支持的路径层数上限，超出的元素在树内只读。 */
const MAX_SELECTABLE_DEPTH = 64;
const MAX_CLASSES = 3;
const MAX_TEXT_PREVIEW_LENGTH = 40;

/** 非 editable 能力的中文原因。 */
const REASON_SVG = 'SVG 内容仅支持文字、样式与结构调整';
const REASON_IMPLICIT = '源码中无显式标签';
const REASON_DEEP = '层级超出预览桥接上限';

export interface ElementTreeNode {
  /** 从 body 子元素起的元素序号路径（与桥接 select-path 一致）。 */
  path: number[];
  tagName: string;
  id: string | null;
  /** class 列表，最多 3 个，超出省略。 */
  classes: string[];
  /** 首个直接文本子节点 trim 后 ≤40 字符；无则空串。 */
  textPreview: string;
  /** editable 可全量编辑；implicit 源码无显式标签（只读）；svg-subtree 仅文字/样式/结构；deep 超出桥接 64 层（树内只读）。 */
  capability: 'editable' | 'implicit' | 'svg-subtree' | 'deep';
  /** 非 editable 时的中文原因。 */
  reason?: string;
  children: ElementTreeNode[];
  /** 子树因节点数/深度上限被截断。 */
  truncated?: boolean;
}

interface TreeWalkState {
  visited: number;
}

/** 从草稿源码构建元素结构树（body 子元素起）。body 不存在返回空数组。 */
export function buildElementTree(source: string): ElementTreeNode[] {
  const { body } = parseDocument(source);
  if (!body) return [];
  return buildChildren(body, [], false, { visited: 0 }).nodes;
}

/** path 的第一个子元素路径；path 不存在或无子元素返回 null。 */
export function childElementPath(source: string, path: number[]): number[] | null {
  const { document } = parseDocument(source);
  const node = findElement(document, path);
  if (!node) return null;
  if (childElements(node).length === 0) return null;
  return [...path, 0];
}

function buildChildren(
  parent: P5ParentNode,
  parentPath: number[],
  insideSvg: boolean,
  state: TreeWalkState
): { nodes: ElementTreeNode[]; truncated: boolean } {
  const nodes: ElementTreeNode[] = [];
  const elements = childElements(parent);
  let truncated = false;
  for (let index = 0; index < elements.length; index += 1) {
    if (state.visited >= MAX_VISITED_NODES || parentPath.length >= MAX_TREE_DEPTH) {
      truncated = true;
      break;
    }
    state.visited += 1;
    nodes.push(buildNode(elements[index], [...parentPath, index], insideSvg, state));
  }
  return { nodes, truncated };
}

function buildNode(
  element: P5Element,
  path: number[],
  insideSvg: boolean,
  state: TreeWalkState
): ElementTreeNode {
  const tagName = element.nodeName.toLowerCase();
  const inSvg = insideSvg || tagName === 'svg';
  const node: ElementTreeNode = {
    path,
    tagName,
    id: attrValue(element, 'id') ?? null,
    classes: parseClasses(attrValue(element, 'class')),
    textPreview: textPreview(element),
    capability: 'editable',
    children: [],
  };
  if (inSvg) {
    node.capability = 'svg-subtree';
    node.reason = REASON_SVG;
  } else if (!element.sourceCodeLocation) {
    node.capability = 'implicit';
    node.reason = REASON_IMPLICIT;
  } else if (path.length >= MAX_SELECTABLE_DEPTH) {
    node.capability = 'deep';
    node.reason = REASON_DEEP;
  }
  if (node.capability === 'deep') return node;
  const { nodes, truncated } = buildChildren(element, path, inSvg, state);
  node.children = nodes;
  if (truncated) node.truncated = true;
  return node;
}

function parseClasses(classAttr: string | undefined): string[] {
  if (!classAttr) return [];
  return classAttr.trim().split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES);
}

function textPreview(element: P5Element): string {
  for (const child of element.childNodes) {
    if (isTextNode(child)) return child.value.trim().slice(0, MAX_TEXT_PREVIEW_LENGTH);
  }
  return '';
}
