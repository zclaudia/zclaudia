import type { AgentTool } from '@earendil-works/pi-agent-core';
import { stat } from 'fs/promises';
import * as path from 'path';

import { buildRangeDescriptor, buildReadStateDescriptor, fileDigest } from './file-state.js';
import type { FileMutationToolOptions } from './edit-write-tools.js';
import { createEditBridgeTool } from './edit-write-tools.js';
import type { ReadFileStateStore } from './read-file-state.js';
import { readTextFileWithMetadata } from './text-io.js';
import { errorResult, textResult, toolParams } from './tool-common.js';
import { MAX_EDIT_FILE_BYTES } from './write-guards.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

type SymbolKind = 'class' | 'function' | 'method' | 'variable';

interface LineInfo {
  number: number;
  text: string;
  startOffset: number;
  endOffset: number;
  endOffsetWithNewline: number;
}

interface SymbolMatch {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
  bodyDigest: string;
  indent: number;
}

interface ReadSymbolOptions {
  readFileState?: ReadFileStateStore;
}

function splitLines(content: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  let lineNumber = 1;
  while (offset < content.length) {
    const newline = content.indexOf('\n', offset);
    const endOffsetWithNewline = newline === -1 ? content.length : newline + 1;
    const endOffset = newline === -1
      ? content.length
      : content[newline - 1] === '\r' ? newline - 1 : newline;
    lines.push({
      number: lineNumber,
      text: content.slice(offset, endOffset),
      startOffset: offset,
      endOffset,
      endOffsetWithNewline,
    });
    offset = endOffsetWithNewline;
    lineNumber += 1;
  }
  if (content.length === 0) {
    lines.push({ number: 1, text: '', startOffset: 0, endOffset: 0, endOffsetWithNewline: 0 });
  }
  return lines;
}

function indentation(text: string): number {
  return text.match(/^\s*/)?.[0].replace(/\t/g, '    ').length ?? 0;
}

function includeDecorators(lines: LineInfo[], index: number, indent: number): number {
  let start = index;
  while (start > 0) {
    const previous = lines[start - 1];
    if (indentation(previous.text) === indent && previous.text.trim().startsWith('@')) start -= 1;
    else break;
  }
  return start;
}

function digestSymbol(text: string): string {
  return fileDigest(text);
}

function buildMatch(
  input: Omit<SymbolMatch, 'text' | 'bodyDigest'>,
  content: string,
): SymbolMatch {
  const text = content.slice(input.startOffset, input.endOffset);
  return {
    ...input,
    text,
    bodyDigest: digestSymbol(text),
  };
}

function pythonSymbols(content: string): SymbolMatch[] {
  const lines = splitLines(content);
  const matches: SymbolMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(\s*)(?:(async)\s+)?(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line.text);
    if (!match) continue;
    const indent = indentation(match[1]);
    const startIndex = includeDecorators(lines, index, indent);
    let endIndex = lines.length - 1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate.text.trim()) continue;
      if (indentation(candidate.text) <= indent) {
        endIndex = cursor - 1;
        break;
      }
    }
    while (endIndex > index && !lines[endIndex].text.trim()) endIndex -= 1;
    const kind: SymbolKind = match[3] === 'class' ? 'class' : 'function';
    matches.push(buildMatch({
      name: match[4],
      qualifiedName: match[4],
      kind,
      startLine: lines[startIndex].number,
      endLine: lines[endIndex].number,
      startOffset: lines[startIndex].startOffset,
      endOffset: lines[endIndex].endOffsetWithNewline,
      indent,
    }, content));
  }
  return qualifyNestedSymbols(matches);
}

function findOpeningBrace(content: string, startOffset: number, maxOffset: number): number {
  const brace = content.indexOf('{', startOffset);
  return brace !== -1 && brace < maxOffset ? brace : -1;
}

function findStatementEnd(lines: LineInfo[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (/[;}]$/.test(lines[index].text.trim())) return index;
  }
  return startIndex;
}

function findMatchingBrace(content: string, openOffset: number): number {
  let depth = 0;
  let quote: '"' | '\'' | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = openOffset; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    const prev = content[index - 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote && prev !== '\\') quote = undefined;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function lineIndexForOffset(lines: LineInfo[], offset: number): number {
  const index = lines.findIndex(line => offset >= line.startOffset && offset <= line.endOffsetWithNewline);
  return index === -1 ? lines.length - 1 : index;
}

function jsSymbols(content: string): SymbolMatch[] {
  const lines = splitLines(content);
  const matches: SymbolMatch[] = [];
  const patterns: Array<{ kind: SymbolKind; regex: RegExp }> = [
    { kind: 'function', regex: /^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: 'class', regex: /^\s*(?:export\s+default\s+|export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: 'variable', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/ },
    { kind: 'method', regex: /^\s*(?:(?:public|private|protected|static|async|get|set|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::[^{]+)?\{/ },
  ];
  const ignoredMethodNames = new Set(['if', 'for', 'while', 'switch', 'catch', 'function']);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line.text);
      if (!match) continue;
      if (pattern.kind === 'method' && ignoredMethodNames.has(match[1])) continue;
      const indent = indentation(line.text);
      const startIndex = includeDecorators(lines, index, indent);
      const searchEnd = Math.min(content.length, line.startOffset + 5_000);
      const openBrace = findOpeningBrace(content, line.startOffset, searchEnd);
      const bodyEnd = openBrace === -1 ? -1 : findMatchingBrace(content, openBrace);
      const endIndex = bodyEnd === -1 ? findStatementEnd(lines, index) : lineIndexForOffset(lines, bodyEnd);
      matches.push(buildMatch({
        name: match[1],
        qualifiedName: match[1],
        kind: pattern.kind,
        startLine: lines[startIndex].number,
        endLine: lines[endIndex].number,
        startOffset: lines[startIndex].startOffset,
        endOffset: lines[endIndex].endOffsetWithNewline,
        indent,
      }, content));
      break;
    }
  }
  return qualifyNestedSymbols(matches);
}

function qualifyNestedSymbols(symbols: SymbolMatch[]): SymbolMatch[] {
  return symbols.map(symbol => {
    const parents = symbols
      .filter(candidate =>
        candidate !== symbol
        && candidate.startOffset <= symbol.startOffset
        && candidate.endOffset >= symbol.endOffset
        && candidate.indent < symbol.indent)
      .sort((a, b) => a.startOffset - b.startOffset);
    const qualifiedName = [...parents.map(parent => parent.name), symbol.name].join('.');
    return { ...symbol, qualifiedName };
  });
}

function symbolsForFile(content: string, filePath: string): SymbolMatch[] | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (['.py', '.pyw', '.pyi'].includes(ext)) return pythonSymbols(content);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) return jsSymbols(content);
  return undefined;
}

function findSymbol(content: string, filePath: string, symbol: string): { ok: true; match: SymbolMatch } | {
  ok: false;
  result: ReturnType<typeof errorResult>;
} {
  const all = symbolsForFile(content, filePath);
  const relSymbol = symbol.trim();
  if (!all) {
    return { ok: false, result: errorResult('unsupported_language', 'ReadSymbol/EditSymbol supports Python, TypeScript, and JavaScript files.') };
  }
  const candidates = all.filter(match =>
    match.qualifiedName === relSymbol
    || (!relSymbol.includes('.') && match.name === relSymbol));
  if (candidates.length === 0) {
    return { ok: false, result: errorResult('symbol_not_found', `Symbol not found: ${relSymbol}`, { symbol: relSymbol }) };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      result: errorResult('ambiguous_symbol', `Symbol name is ambiguous: ${relSymbol}. Use a qualified name.`, {
        symbol: relSymbol,
        candidates: candidates.map(match => ({
          symbol: match.qualifiedName,
          kind: match.kind,
          startLine: match.startLine,
          endLine: match.endLine,
        })),
      }),
    };
  }
  return { ok: true, match: candidates[0] };
}

function formatSymbol(match: SymbolMatch): string {
  return match.text
    .replace(/\n$/, '')
    .split(/\r?\n/)
    .map((line, index) => `${match.startLine + index}|${line}`)
    .join('\n');
}

export function createReadSymbolTool(cwd: string, options?: ReadSymbolOptions): AgentTool<any> {
  return {
    name: 'ReadSymbol',
    label: 'ReadSymbol',
    description: 'Read one named function, method, class, or exported variable from a Python/TypeScript/JavaScript file. Prefer this over line-number reads when you know the symbol name.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative source file path' },
        path: { type: 'string', description: 'Alias for file_path' },
        symbol: { type: 'string', description: 'Symbol name, e.g. "run", "Client.connect", or "_schedule_chat"' },
      },
      required: ['symbol'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requested = args.file_path ?? args.path;
      if (typeof requested !== 'string' || !requested.trim()) return errorResult('missing_path', 'ReadSymbol requires file_path');
      if (typeof args.symbol !== 'string' || !args.symbol.trim()) return errorResult('missing_symbol', 'ReadSymbol requires symbol');
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      const relPath = toWorkspaceRelative(cwd, filePath);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) return errorResult('not_a_file', `Path is not a file: ${relPath}`, { path: relPath });
        if (fileStat.size > MAX_EDIT_FILE_BYTES) {
          return errorResult('file_too_large', `File is too large for symbol reads: ${relPath}`, {
            path: relPath,
            size: fileStat.size,
            maxSize: MAX_EDIT_FILE_BYTES,
          });
        }
        const metadata = await readTextFileWithMetadata(filePath);
        const found = findSymbol(metadata.content, filePath, args.symbol);
        if (!found.ok) return found.result;
        const match = found.match;
        const lines = splitLines(metadata.content);
        await options?.readFileState?.recordRead(filePath, {
          content: metadata.content,
          offset: 1,
          limit: lines.length,
          totalLines: lines.length,
          returnedLines: match.endLine - match.startLine + 1,
          isPartialView: true,
          hasFullContent: true,
          timestamp: fileStat.mtimeMs,
        });
        return textResult(
          `[Symbol ${relPath}#${match.qualifiedName} lines ${match.startLine}-${match.endLine} digest=${match.bodyDigest}]\n${formatSymbol(match)}`,
          {
            ok: true,
            path: relPath,
            symbol: match.qualifiedName,
            requestedSymbol: args.symbol,
            kind: match.kind,
            startLine: match.startLine,
            endLine: match.endLine,
            bodyDigest: match.bodyDigest,
            text: match.text,
            state: buildReadStateDescriptor({
              relPath,
              content: metadata.content,
              range: buildRangeDescriptor(match.startLine, match.text.replace(/\n$/, '').split(/\r?\n/)),
              fullContentCaptured: true,
              partialView: true,
            }),
          },
        );
      } catch (err) {
        return errorResult('read_symbol_failed', err instanceof Error ? err.message : String(err), { path: relPath });
      }
    },
  } as unknown as AgentTool<any>;
}

export function createEditSymbolTool(cwd: string, options?: FileMutationToolOptions): AgentTool<any> {
  return {
    name: 'EditSymbol',
    label: 'EditSymbol',
    description: 'Replace one named function, method, class, or exported variable in a Python/TypeScript/JavaScript file. ReadSymbol returns the bodyDigest you can pass as expected_body_digest to guard against stale symbol edits.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative source file path' },
        path: { type: 'string', description: 'Alias for file_path' },
        symbol: { type: 'string', description: 'Symbol name, e.g. "run", "Client.connect", or "_schedule_chat"' },
        new_body: { type: 'string', description: 'Full replacement text for the symbol, including its declaration line' },
        expected_body_digest: { type: 'string', description: 'Optional bodyDigest from ReadSymbol' },
        preview_only: { type: 'boolean', default: false },
      },
      required: ['symbol', 'new_body'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requested = args.file_path ?? args.path;
      if (typeof requested !== 'string' || !requested.trim()) return errorResult('missing_path', 'EditSymbol requires file_path');
      if (typeof args.symbol !== 'string' || !args.symbol.trim()) return errorResult('missing_symbol', 'EditSymbol requires symbol');
      if (typeof args.new_body !== 'string') return errorResult('missing_body', 'EditSymbol requires new_body');
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      const relPath = toWorkspaceRelative(cwd, filePath);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) return errorResult('not_a_file', `Path is not a file: ${relPath}`, { path: relPath });
        if (fileStat.size > MAX_EDIT_FILE_BYTES) {
          return errorResult('file_too_large', `File is too large for symbol edits: ${relPath}`, {
            path: relPath,
            size: fileStat.size,
            maxSize: MAX_EDIT_FILE_BYTES,
          });
        }
        const metadata = await readTextFileWithMetadata(filePath);
        const found = findSymbol(metadata.content, filePath, args.symbol);
        if (!found.ok) return found.result;
        const match = found.match;
        if (typeof args.expected_body_digest === 'string'
          && args.expected_body_digest.trim()
          && args.expected_body_digest.trim() !== match.bodyDigest) {
          return errorResult('stale_symbol', 'Symbol digest does not match expected_body_digest. ReadSymbol again before editing.', {
            path: relPath,
            symbol: match.qualifiedName,
            expectedBodyDigest: args.expected_body_digest.trim(),
            currentBodyDigest: match.bodyDigest,
            retryable: true,
            suggestedAction: 'read_symbol',
          });
        }
        const edit = createEditBridgeTool(cwd, options) as any;
        const result = await edit.execute(`${toolCallId}:edit`, {
          file_path: requested,
          old_string: match.text,
          new_string: args.new_body,
          preview_only: args.preview_only === true,
        });
        return {
          ...result,
          details: {
            ...(result.details ?? {}),
            symbol: match.qualifiedName,
            symbolKind: match.kind,
            previousBodyDigest: match.bodyDigest,
            newBodyDigest: digestSymbol(args.new_body),
          },
        };
      } catch (err) {
        return errorResult('edit_symbol_failed', err instanceof Error ? err.message : String(err), { path: relPath });
      }
    },
  } as unknown as AgentTool<any>;
}
