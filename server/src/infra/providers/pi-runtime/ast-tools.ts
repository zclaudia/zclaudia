/**
 * Structural search and rewrite via ast-grep (tree-sitter based).
 *
 * AstGrep finds AST-pattern matches ("console.log($ARG)") across the
 * workspace; AstEdit rewrites them with metavariable substitution, going
 * through the same safeguards as Edit/Write (auto-generated guard, write
 * lock, backup, read-state update). Languages: JS/TS/TSX/HTML/CSS (the
 * parsers bundled with @ast-grep/napi).
 */
import { readdirSync, statSync } from 'fs';
import * as path from 'path';
import type { Lang, SgNode } from '@ast-grep/napi';

const LANG_BY_EXT: Record<string, string> = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.tsx': 'Tsx',
  '.html': 'Html',
  '.css': 'Css',
};

const SKIPPED_DIRS = new Set(['node_modules', '.git', '.worktrees', 'dist', 'build', 'coverage']);
const MAX_CANDIDATE_FILES = 500;

export function langForFile(filePath: string): string | undefined {
  return LANG_BY_EXT[path.extname(filePath).toLowerCase()];
}

/** Collect parseable files under root (file or directory), bounded and ignore-aware. */
export function collectAstFiles(root: string): string[] {
  const rootStat = statSync(root);
  if (rootStat.isFile()) return langForFile(root) ? [root] : [];
  const results: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && results.length < MAX_CANDIDATE_FILES) {
    const dir = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (results.length >= MAX_CANDIDATE_FILES) break;
      const full = path.join(dir, entry);
      let entryStat;
      try {
        entryStat = statSync(full);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry) && !entry.startsWith('.')) queue.push(full);
      } else if (entryStat.isFile() && langForFile(full)) {
        results.push(full);
      }
    }
  }
  return results;
}

interface MetaVariableSource {
  getMatch(name: string): { text(): string } | null;
  getMultipleMatches(name: string): Array<{ text(): string }>;
}

/** Substitute $VAR and $$$VAR metavariable references in a rewrite template. */
export function substituteMetaVariables(rewrite: string, match: MetaVariableSource): string {
  return rewrite
    .replace(/\$\$\$([A-Z_][A-Z0-9_]*)/g, (_whole, name: string) =>
      match
        .getMultipleMatches(name)
        .map(node => node.text())
        .join(', ')
    )
    .replace(
      /\$([A-Z_][A-Z0-9_]*)/g,
      (whole, name: string) => match.getMatch(name)?.text() ?? whole
    );
}

export interface AstMatch {
  /** 1-based line of the match start. */
  line: number;
  text: string;
  node: SgNode;
}

let napiModule: typeof import('@ast-grep/napi') | undefined;
async function loadNapi(): Promise<typeof import('@ast-grep/napi')> {
  if (!napiModule) napiModule = await import('@ast-grep/napi');
  return napiModule;
}

export async function findAstMatches(
  content: string,
  filePath: string,
  pattern: string
): Promise<AstMatch[]> {
  const langName = langForFile(filePath);
  if (!langName) return [];
  const napi = await loadNapi();
  const lang = (napi.Lang as Record<string, Lang>)[langName];
  const root = napi.parse(lang, content).root();
  return root.findAll(pattern).map(node => ({
    line: node.range().start.line + 1,
    text: node.text(),
    node,
  }));
}

export interface AstRewriteResult {
  updated: string;
  replaced: number;
}

export async function rewriteAstMatches(
  content: string,
  filePath: string,
  pattern: string,
  rewrite: string
): Promise<AstRewriteResult | undefined> {
  const langName = langForFile(filePath);
  if (!langName) return undefined;
  const napi = await loadNapi();
  const lang = (napi.Lang as Record<string, Lang>)[langName];
  const root = napi.parse(lang, content).root();
  const matches = root.findAll(pattern);
  if (matches.length === 0) return undefined;
  const edits = matches.map(match => match.replace(substituteMetaVariables(rewrite, match)));
  return { updated: root.commitEdits(edits), replaced: matches.length };
}
