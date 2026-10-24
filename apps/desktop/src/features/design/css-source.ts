/**
 * P3.5 C2：宿主侧源码对齐与规则模型（纯模块，无 IO/DOM 依赖）。
 *
 * 桥接（preview.ts）在 iframe 内用 CSSOM 枚举命中规则并上报身份
 * （DesignMatchedRule：origin + rulePath + selectorText 指纹 + specificity）；
 * 本模块把每条命中对齐回入口 HTML 的 `<style>` 块源码：
 * parse5 按文档序枚举样式块（序号即 `@inline/<n>`）→ postcss 解析块文本 →
 * 按 rulePath 逐级索引 → 选择器归一比对。任一步失败一律只读并给原因，绝不猜测定位。
 *
 * 展示与写回都基于源码文本（预览构建会把 url() 改写为 data URL，CSSOM 文本
 * 不上屏不写回）；声明行携带 htmlSource 绝对偏移，供 §4 patch 直接 splice。
 */
import postcss from 'postcss';
import { childElements, isTextNode, parseDocument, type P5Element, type P5ParentNode } from './html/parse';
import { compareCssValues } from './html/style-compare';
import { STYLE_BLOCK_MAX_BYTES, type DesignComputedStyles, type DesignMatchedRule } from './types';

/** 单条声明行（宿主侧源码解析所得，非 CSSOM 序列化文本）。 */
export interface CssDeclarationRow {
  property: string;
  value: string;
  /** 取自 postcss Declaration.important；仅徽标展示，不参与 winning 反转（§0.6）。 */
  important: boolean;
  /** 生效中判定：仅计算键且计算值存在时有 true/false；无可靠口径为 null（不显示徽标）。 */
  winning: boolean | null;
  /** 对齐成功的规则内恒为 true；只读规则的声明行为 false。 */
  editable: boolean;
  /** 声明整体（属性起到 !important 止）在 htmlSource 中的 [start, end)。 */
  start: number;
  end: number;
  /** 值子区间（不含 !important 后缀）的 [start, end)。 */
  valueStart: number;
  valueEnd: number;
}

/** 单条匹配规则的宿主侧行：对齐成功携带源码声明；失败则只读且声明为空。 */
export interface CssRuleRow {
  origin: string;
  /** 桥接上报的命中选择器原文（透传展示）。 */
  selectorText: string;
  rulePath: number[];
  specificity: [number, number, number];
  readOnly: null | {
    reason: 'parse-error' | 'align-mismatch' | 'external-css-readonly' | 'oversize';
  };
  declarations: CssDeclarationRow[];
}

type ReadOnlyReason = NonNullable<CssRuleRow['readOnly']>['reason'];

type WinningKey = keyof DesignComputedStyles | 'color' | 'background-color';

/**
 * 生效判定键集：select 消息的计算样式键（types.ts DesignComputedStyles 键集），
 * 另加随 select 顶层字段下发的 color/background-color（与 reselect 回路口径一致）。
 */
const WINNING_KEY_LIST = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'object-fit',
  'color',
  'background-color',
] as const satisfies readonly WinningKey[];
const WINNING_KEYS: ReadonlySet<string> = new Set(WINNING_KEY_LIST);

/** 预览来源标记的入口自有 `<style>` 块前缀（preview.ts 打标口径）。 */
const INLINE_ORIGIN_PREFIX = '@inline/';

/** 对齐命中并解析出的一条规则（resolveOrigin 的成功形态）。 */
interface AlignedBlock {
  block: StyleBlock;
  parse: BlockParse;
}

export function buildStyleRules(input: {
  htmlSource: string;
  matched: DesignMatchedRule[];
  computed: Partial<Record<string, string>>;
  inlineStyle: string | null;
}): CssRuleRow[] {
  const blocks = enumerateStyleBlocks(input.htmlSource);
  const parses = new Map<number, BlockParseResult>();
  const rows: CssRuleRow[] = [];
  const candidates: WinningCandidate[] = [];

  for (const rule of input.matched) {
    const row: CssRuleRow = {
      origin: rule.origin,
      selectorText: rule.selectorText,
      rulePath: [...rule.rulePath],
      specificity: [...rule.specificity],
      readOnly: null,
      declarations: [],
    };
    rows.push(row);
    const target = resolveOrigin(rule.origin, blocks, parses);
    if (typeof target === 'string') {
      row.readOnly = { reason: target };
      continue;
    }
    const node = resolveRulePath(target.parse.root, rule.rulePath);
    if (!node || normalizeSelector(node.selector) !== normalizeSelector(rule.selectorText)) {
      row.readOnly = { reason: 'align-mismatch' };
      continue;
    }
    row.declarations = declarationsOf(node, target.block, target.parse);
    for (const declaration of row.declarations) {
      candidates.push({
        property: declaration.property,
        value: declaration.value,
        inline: false,
        specificity: row.specificity,
        order: declaration.start,
        declaration,
      });
    }
  }

  // inline 声明只参与 winning 级联（§3：inline 面板仍是其唯一编辑入口），不产生行。
  for (const { property, value } of inlineDeclarations(input.inlineStyle)) {
    candidates.push({ property, value, inline: true, specificity: [0, 0, 0], order: 0, declaration: null });
  }

  applyWinning(candidates, input.computed);
  return rows;
}

// ---------------------------------------------------------------------------
// 入口 `<style>` 块枚举（parse5）
// ---------------------------------------------------------------------------

interface StyleBlock {
  ordinal: number;
  /** 块文本（htmlSource 原文切片）；无法定位或无文本时为 null，其规则一律 align-mismatch。 */
  text: string | null;
  /** 块文本首字符在 htmlSource 中的绝对偏移（text 为 null 时无意义）。 */
  textStartOffset: number;
}

/** 按文档序枚举入口 `<style>` 元素，序号即预览标记的 `@inline/<n>`。 */
function enumerateStyleBlocks(htmlSource: string): Map<number, StyleBlock> {
  const blocks = new Map<number, StyleBlock>();
  const { document } = parseDocument(htmlSource);
  let ordinal = 0;
  const visit = (node: P5ParentNode): void => {
    for (const el of childElements(node)) {
      if (el.nodeName === 'style') {
        blocks.set(ordinal, blockOf(htmlSource, ordinal, el));
        ordinal += 1;
      }
      visit(el);
    }
  };
  visit(document);
  return blocks;
}

function blockOf(source: string, ordinal: number, el: P5Element): StyleBlock {
  const texts = el.childNodes.filter(isTextNode);
  const first = texts[0]?.sourceCodeLocation;
  const last = texts[texts.length - 1]?.sourceCodeLocation;
  // parse5 对隐式创建的节点不提供位置；无文本子节点的块同样无从对齐。
  if (!el.sourceCodeLocation || !first || !last) return { ordinal, text: null, textStartOffset: 0 };
  const textStartOffset = first.startOffset;
  // style 是 RAWTEXT 元素：源码切片与文本值逐字一致，用切片保证偏移对齐。
  return { ordinal, text: source.slice(textStartOffset, last.endOffset), textStartOffset };
}

// ---------------------------------------------------------------------------
// postcss 解析与 (line, column) → 绝对偏移换算
// ---------------------------------------------------------------------------

interface BlockParse {
  root: postcss.Root;
  /** 块文本（BOM 剥离后）每行首偏移：postcss 节点只有 1 起的 line/column，据此换算块内偏移。 */
  lineStarts: number[];
  /** 解析前剥离的行首 BOM 宽度（postcss 会静默剥离，不补偿会整体错位一位）。 */
  bomLength: number;
}

type BlockParseResult = BlockParse | { error: true };

/** 每块至多解析一次（同一块可能被多条命中规则引用）。 */
function parseBlock(block: StyleBlock, cache: Map<number, BlockParseResult>): BlockParseResult {
  const cached = cache.get(block.ordinal);
  if (cached) return cached;
  let result: BlockParseResult;
  try {
    const text = block.text ?? '';
    const bomLength = text.startsWith('\uFEFF') ? 1 : 0;
    const css = bomLength ? text.slice(bomLength) : text;
    const root = postcss.parse(css, { map: false });
    result = { root, lineStarts: lineStartsOf(css), bomLength };
  } catch {
    // 语法错误整块只读：无法给出任何可靠偏移。
    result = { error: true };
  }
  cache.set(block.ordinal, result);
  return result;
}

function lineStartsOf(css: string): number[] {
  const starts = [0];
  for (let i = 0; i < css.length; i += 1) {
    if (css.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** 块内 (line, column)（1 起，postcss 口径，与 Input 的行表同为按 \n 切分）→ htmlSource 绝对偏移。 */
function absOffset(block: StyleBlock, parse: BlockParse, pos: postcss.Position): number {
  const lineStart = parse.lineStarts[pos.line - 1] ?? 0;
  return block.textStartOffset + parse.bomLength + lineStart + pos.column - 1;
}

function resolveOrigin(
  origin: string,
  blocks: Map<number, StyleBlock>,
  parses: Map<number, BlockParseResult>
): AlignedBlock | ReadOnlyReason {
  // 第一批口径：非 @inline 的 origin（外部 .css 路径）一律只读展示（§6 第二批放开）。
  if (!origin.startsWith(INLINE_ORIGIN_PREFIX)) return 'external-css-readonly';
  const ordinal = Number(origin.slice(INLINE_ORIGIN_PREFIX.length));
  const block = Number.isInteger(ordinal) ? blocks.get(ordinal) : undefined;
  if (!block || block.text === null) return 'align-mismatch';
  if (byteLength(block.text) > STYLE_BLOCK_MAX_BYTES) return 'oversize';
  const parse = parseBlock(block, parses);
  if ('error' in parse) return 'parse-error';
  return { block, parse };
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

// ---------------------------------------------------------------------------
// rulePath 索引对齐与选择器指纹
// ---------------------------------------------------------------------------

/**
 * 按 rulePath 取规则节点：每级索引是父容器 nodes 数组的下标；注释、游离声明等
 * 非 Rule/AtRule 节点计入索引但不产出规则（与浏览器 CSSOM 丢弃未知 at-rule 的
 * 差异由选择器指纹兜住）。中间级必须是 AtRule 分组，末级必须是 Rule；
 * 越界或类型不符返回 null（对不上即 align-mismatch，不猜）。
 */
function resolveRulePath(root: postcss.Root, rulePath: number[]): postcss.Rule | null {
  let container: postcss.Root | postcss.AtRule = root;
  for (let depth = 0; depth < rulePath.length; depth += 1) {
    const index = rulePath[depth];
    // 显式标注避免 container/node 循环推断（TS7022）。
    const node: postcss.ChildNode | undefined = (container.nodes ?? [])[index];
    if (!node) return null;
    if (depth === rulePath.length - 1) return node.type === 'rule' ? node : null;
    if (node.type !== 'atrule') return null;
    container = node;
  }
  return null; // 空 rulePath 不是合法身份
}

/** 指纹归一：trim + 连续空白折叠为单空格；严格相等，不做模糊/邻近匹配（§3）。 */
const normalizeSelector = (selector: string): string => selector.trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// 声明行（源码偏移）
// ---------------------------------------------------------------------------

function declarationsOf(rule: postcss.Rule, block: StyleBlock, parse: BlockParse): CssDeclarationRow[] {
  const rows: CssDeclarationRow[] = [];
  for (const node of rule.nodes) {
    if (node.type !== 'decl' || !node.source?.start || !node.source?.end) continue;
    const start = absOffset(block, parse, node.source.start);
    const end = absOffset(block, parse, node.source.end);
    // 值子区间 = 声明起点 + 属性长度 + 属性与值之间的原文（raws.between，如 ": "）。
    const valueStart = start + node.prop.length + (node.raws.between?.length ?? 0);
    rows.push({
      property: node.prop,
      value: node.value,
      // postcss 仅在带 !important 时才写入该字段，运行时可能是 undefined。
      important: Boolean(node.important),
      winning: null,
      editable: true,
      start,
      end,
      valueStart,
      valueEnd: valueStart + node.value.length,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// winning 判定（§0.6：级联序 + 计算值等值；不做完整级联模拟）
// ---------------------------------------------------------------------------

interface WinningCandidate {
  property: string;
  value: string;
  /** inline 声明在级联序中恒排规则声明之后（inline 属性优先）。 */
  inline: boolean;
  specificity: [number, number, number];
  /** htmlSource 绝对偏移：同特异性时后写胜。 */
  order: number;
  /** 归属的声明行；inline 候选为 null（不产生行）。 */
  declaration: CssDeclarationRow | null;
}

const specificityDelta = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** 级联序升序比较：规则在前、inline 在后；同类内特异性高在后；再按源码后写在后。末位即生效者。 */
const cascadeOrder = (a: WinningCandidate, b: WinningCandidate): number => {
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  const specificity = specificityDelta(a.specificity, b.specificity);
  return specificity !== 0 ? specificity : a.order - b.order;
};

/**
 * 同属性候选按级联序取末位，与计算值等值判定（复用 html/style-compare.ts，
 * 与 DesignPanel.reselectMismatch 同一口径）。等值 → 末位标 true、同属性行 false；
 * 失配 → 该属性各行均标 false（级落末位已确定不是生效值）；判不出 → 保持 null。
 * !important 不参与反转：层叠层/origin 反转等复杂情形不声称覆盖，计算值为最终口径。
 */
function applyWinning(candidates: WinningCandidate[], computed: Partial<Record<string, string>>): void {
  const groups = new Map<string, WinningCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.property.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  for (const [key, group] of groups) {
    const computedValue = computed[key];
    if (!WINNING_KEYS.has(key) || typeof computedValue !== 'string') continue;
    const sorted = [...group].sort(cascadeOrder);
    const winner = sorted[sorted.length - 1];
    const verdict = compareCssValues(key, winner.value, computedValue);
    if (verdict === null) continue;
    for (const candidate of sorted) {
      if (candidate.declaration) candidate.declaration.winning = candidate === winner ? verdict : false;
    }
  }
}

/**
 * inline style 属性原文的简易声明拆分（仅作 winning 级联的输入）：
 * 按分号拆分、首个冒号分隔属性与值；同名属性保留最后一条（inline 级联后写胜）。
 */
function inlineDeclarations(inlineStyle: string | null): { property: string; value: string }[] {
  if (!inlineStyle) return [];
  const byProperty = new Map<string, string>();
  for (const chunk of inlineStyle.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon <= 0) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (property && value) byProperty.set(property, value);
  }
  return [...byProperty].map(([property, value]) => ({ property, value }));
}
