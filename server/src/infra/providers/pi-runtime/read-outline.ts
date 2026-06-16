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
const BRACE_EXTS = new Set(['.go', '.rs', '.java', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.m', '.mm', '.kt', '.swift', '.scala']);
const INDENT_EXTS = new Set(['.py', '.pyi', '.rb', '.coffee']);

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

// Naive brace-depth fold: collapses the interior of each outermost {...} block.
// Best-effort — braces inside strings/comments can miscount (acceptable; full:true escapes).
function braceFolds(lines: string[]): FoldSpan[] {
  const folds: FoldSpan[] = [];
  let depth = 0;
  let openLine = -1; // 1-based line where the outermost block opened
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let opens = 0;
    let closes = 0;
    for (const ch of line) {
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }
    const before = depth;
    depth = Math.max(0, depth + opens - closes);
    if (before === 0 && depth > 0 && openLine === -1) {
      openLine = i + 1;
    } else if (before > 0 && depth === 0 && openLine !== -1) {
      const startLine = openLine + 1;
      const endLine = i; // line i+1 is the close brace; interior ends the line before
      if (endLine - startLine + 1 >= OUTLINE_MIN_BODY_LINES) folds.push({ startLine, endLine });
      openLine = -1;
    }
  }
  return folds;
}

// Naive indentation fold: a header line ending in ':' followed by a more-indented block.
function indentFolds(lines: string[]): FoldSpan[] {
  const folds: FoldSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/:\s*(#.*)?$/.test(lines[i].trimEnd())) continue;
    const headerIndent = lines[i].length - lines[i].trimStart().length;
    let j = i + 1;
    let lastNonBlank = i;
    while (j < lines.length) {
      if (lines[j].trim() === '') { j++; continue; }
      const indent = lines[j].length - lines[j].trimStart().length;
      if (indent <= headerIndent) break;
      lastNonBlank = j;
      j++;
    }
    const startLine = i + 2;          // header is line i+1; body starts next
    const endLine = lastNonBlank + 1;
    if (endLine - startLine + 1 >= OUTLINE_MIN_BODY_LINES) {
      folds.push({ startLine, endLine });
      i = lastNonBlank; // outermost only
    }
  }
  return folds;
}

const braceProvider: OutlineProvider = {
  kind: 'heuristic',
  async findFolds(content) {
    return normalizeFolds(braceFolds(content.split(/\r?\n/)));
  },
};

const indentProvider: OutlineProvider = {
  kind: 'heuristic',
  async findFolds(content) {
    return normalizeFolds(indentFolds(content.split(/\r?\n/)));
  },
};

export function getOutlineProvider(fileExt: string): OutlineProvider | undefined {
  const ext = fileExt.toLowerCase();
  if (AST_EXTS.has(ext)) return astProvider;
  if (BRACE_EXTS.has(ext)) return braceProvider;
  if (INDENT_EXTS.has(ext)) return indentProvider;
  return undefined;
}
