import { Fragment, useMemo, useState } from 'react';
import { buildElementTree } from '../element-tree';
import type { ElementTreeNode } from '../element-tree';

const EMPTY_TEXT = 'This page has no displayable elements.';
/** 默认展开前两层（path 长度 ≤2 的节点处于展开状态）。 */
const DEFAULT_EXPAND_DEPTH = 2;

export interface ElementTreeProps {
  /** 活动页草稿源码；变化即重建（useMemo(source)）。 */
  source: string;
  /** 当前选区路径；与节点路径深相等的行高亮。 */
  selectionPath: number[] | null;
  /** 点击行 → 向预览桥接请求选择该元素。 */
  onSelectPath: (path: number[]) => void;
}

const nodeKey = (node: ElementTreeNode): string => node.path.join('.');

const pathsEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * 元素结构树（P3 §7.2）：从草稿源码纯函数构建的导航树，默认展开前两层，
 * 行 = 缩进 + `<tag>` + #id + .class（≤3）+ 文本预览（灰字截断）；
 * capability ≠ editable 的行可点击选中（能看计算样式），reason 以禁用色小字展示。
 */
export function ElementTree({ source, selectionPath, onSelectPath }: ElementTreeProps) {
  const tree = useMemo(() => buildElementTree(source), [source]);
  /** 展开/收起状态覆盖表（按 path join key）；缺省 = path 长度 ≤ 默认层数即展开。 */
  const [expandOverrides, setExpandOverrides] = useState<Map<string, boolean>>(() => new Map());

  const isExpanded = (node: ElementTreeNode): boolean =>
    expandOverrides.get(nodeKey(node)) ?? node.path.length <= DEFAULT_EXPAND_DEPTH;

  const toggle = (node: ElementTreeNode) => {
    setExpandOverrides(previous => {
      const next = new Map(previous);
      next.set(nodeKey(node), !isExpanded(node));
      return next;
    });
  };

  const isSelected = (node: ElementTreeNode): boolean =>
    selectionPath !== null && pathsEqual(selectionPath, node.path);

  return (
    <section aria-label="Structure tree" className="flex min-h-0 flex-col">
      {tree.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">{EMPTY_TEXT}</p>
      ) : (
        <div className="overflow-y-auto p-1">
          {tree.map(node => (
            <TreeBranch
              key={nodeKey(node)}
              node={node}
              depth={0}
              isSelected={isSelected}
              isExpanded={isExpanded}
              onToggle={toggle}
              onSelect={onSelectPath}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface TreeBranchProps {
  node: ElementTreeNode;
  depth: number;
  isSelected: (node: ElementTreeNode) => boolean;
  isExpanded: (node: ElementTreeNode) => boolean;
  onToggle: (node: ElementTreeNode) => void;
  onSelect: (path: number[]) => void;
}

function TreeBranch({ node, depth, isSelected, isExpanded, onToggle, onSelect }: TreeBranchProps) {
  const key = nodeKey(node);
  const expanded = isExpanded(node);
  const hasChildren = node.children.length > 0;
  return (
    <Fragment>
      <div className="flex items-start">
        <span className="flex w-4 shrink-0 justify-center pt-0.5">
          {hasChildren && (
            <button
              type="button"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${key}`}
              aria-expanded={expanded}
              onClick={() => onToggle(node)}
              className="text-[9px] leading-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
        </span>
        <button
          type="button"
          aria-label={`Select ${node.tagName} ${key}`}
          aria-current={isSelected(node) || undefined}
          onClick={() => onSelect(node.path)}
          className={`flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden rounded px-1 text-left text-[11px] leading-4 transition-colors hover:bg-muted/60 ${
            isSelected(node) ? 'bg-muted font-medium' : ''
          }`}
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="font-mono text-foreground">&lt;{node.tagName}&gt;</span>
          {node.id && <span className="font-mono text-muted-foreground">#{node.id}</span>}
          {node.classes.map(className => (
            <span key={className} className="font-mono text-muted-foreground">
              .{className}
            </span>
          ))}
          {node.textPreview && (
            <span className="min-w-0 truncate text-muted-foreground">{node.textPreview}</span>
          )}
          {node.capability !== 'editable' && node.reason && (
            <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground/70">
              {node.reason}
            </span>
          )}
          {node.truncated && (
            <span className="shrink-0 pl-1 text-[10px] text-muted-foreground/70">… (truncated)</span>
          )}
        </button>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map(child => (
          <TreeBranch
            key={nodeKey(child)}
            node={child}
            depth={depth + 1}
            isSelected={isSelected}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </Fragment>
  );
}
