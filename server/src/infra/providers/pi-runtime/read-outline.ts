import type { Lang, SgNode } from '@ast-grep/napi';

import { langForFile } from './ast-tools.js';

export interface FoldSpan {
  /** 1-based first line of the collapsible interior (signature/braces stay outside). */
  startLine: number;
  /** 1-based last line of the collapsible interior, inclusive. */
  endLine: number;
}

export interface OutlineProvider {
  readonly kind: 'ast' | 'heuristic';
  findFolds(content: string, filePath: string): Promise<FoldSpan[]>;
}

export const OUTLINE_MIN_BODY_LINES = 4;
export const OUTLINE_MIN_COMMENT_LINES = 6;

const AST_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);

// tree-sitter (JS/TS) node kinds whose interior is a collapsible body.
const BODY_KINDS = new Set(['statement_block', 'class_body', 'object', 'array']);
const COMMENT_KIND = 'comment';

let napiModule: typeof import('@ast-grep/napi') | undefined;
async function loadNapi(): Promise<typeof import('@ast-grep/napi')> {
  if (!napiModule) napiModule = await import('@ast-grep/napi');
  return napiModule;
}

// Drop folds fully contained in an earlier fold; sort by start line.
function normalizeFolds(folds: FoldSpan[]): FoldSpan[] {
  const sorted = [...folds].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const out: FoldSpan[] = [];
  for (const fold of sorted) {
    const last = out[out.length - 1];
    if (last && fold.startLine <= last.endLine) continue; // overlapping/nested → skip
    out.push(fold);
  }
  return out;
}

function walkAst(node: SgNode, out: FoldSpan[]): void {
  const kind = node.kind() as string;
  const isComment = kind === COMMENT_KIND;
  if (BODY_KINDS.has(kind) || isComment) {
    const range = node.range();
    const openLine = range.start.line + 1; // 0-based → 1-based
    const closeLine = range.end.line + 1;
    const startLine = openLine + 1;
    const endLine = closeLine - 1;
    const min = isComment ? OUTLINE_MIN_COMMENT_LINES : OUTLINE_MIN_BODY_LINES;
    if (endLine >= startLine && endLine - startLine + 1 >= min) {
      out.push({ startLine, endLine });
      return; // outermost only — do not descend into a folded body
    }
  }
  for (const child of node.children()) walkAst(child, out);
}

const astProvider: OutlineProvider = {
  kind: 'ast',
  async findFolds(content, filePath) {
    const langName = langForFile(filePath);
    if (!langName) return [];
    const napi = await loadNapi();
    const lang = (napi.Lang as Record<string, Lang>)[langName];
    const root = napi.parse(lang, content).root();
    const folds: FoldSpan[] = [];
    walkAst(root, folds);
    return normalizeFolds(folds);
  },
};

export function getOutlineProvider(fileExt: string): OutlineProvider | undefined {
  const ext = fileExt.toLowerCase();
  if (AST_EXTS.has(ext)) return astProvider;
  return undefined;
}
