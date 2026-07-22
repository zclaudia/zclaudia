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

type AgentToolParameters = AgentTool['parameters'];

function agentToolParameters(schema: Record<string, unknown>): AgentToolParameters {
  return schema as AgentToolParameters;
}

function splitLines(content: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  let lineNumber = 1;
  while (offset < content.length) {
    const newline = content.indexOf('\n', offset);
    const endOffsetWithNewline = newline === -1 ? content.length : newline + 1;
    const endOffset =
      newline === -1 ? content.length : content[newline - 1] === '\r' ? newline - 1 : newline;
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

function isEscaped(content: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function previousToken(content: string, index: number): string | undefined {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(content[cursor])) cursor -= 1;
  if (cursor < 0) return undefined;
  if (/[A-Za-z_$0-9]/.test(content[cursor])) {
    let start = cursor;
    while (start > 0 && /[A-Za-z_$0-9]/.test(content[start - 1])) start -= 1;
    return content.slice(start, cursor + 1);
  }
  return content[cursor];
}

function canStartRegexLiteral(content: string, index: number): boolean {
  const previous = previousToken(content, index);
  if (!previous) return true;
  if (
    [
      'return',
      'throw',
      'case',
      'delete',
      'typeof',
      'void',
      'new',
      'in',
      'of',
      'yield',
      'await',
    ].includes(previous)
  )
    return true;
  return [
    '(',
    '[',
    '{',
    '=',
    ':',
    ',',
    ';',
    '!',
    '&',
    '|',
    '?',
    '+',
    '-',
    '*',
    '~',
    '^',
    '<',
    '>',
  ].includes(previous);
}

function buildMatch(input: Omit<SymbolMatch, 'text' | 'bodyDigest'>, content: string): SymbolMatch {
  const text = content.slice(input.startOffset, input.endOffset);
  return {
    ...input,
    text,
    bodyDigest: digestSymbol(text),
  };
}

/** Net ()/[]/{} depth change of one Python line, ignoring brackets inside
 * string literals and after a `#` comment. Good enough for signature spans;
 * multi-line strings inside a signature are not handled. */
function pythonBracketDelta(text: string): number {
  let delta = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '#') break;
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') delta += 1;
    else if (ch === ')' || ch === ']' || ch === '}') delta -= 1;
  }
  return delta;
}

/** Index of the line where a `def`/`class` header closes (brackets balanced).
 * A multi-line signature's closing `) -> str:` dedents back to the def
 * column, so the dedent-based body scan must only start after this line. */
function pythonHeaderEnd(lines: LineInfo[], defIndex: number): number {
  let depth = 0;
  for (let cursor = defIndex; cursor < lines.length; cursor += 1) {
    depth += pythonBracketDelta(lines[cursor].text);
    if (depth <= 0) return cursor;
  }
  return defIndex;
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
    const headerEnd = pythonHeaderEnd(lines, index);
    let endIndex = lines.length - 1;
    for (let cursor = headerEnd + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      const trimmed = candidate.text.trim();
      // Blank lines never close a body. Comment lines never close one either:
      // a comment at (or below) the def's indentation is still legal inside a
      // Python block (comments don't affect indentation), so stopping there
      // would truncate the body and EditSymbol would leave orphaned remainder
      // lines behind, corrupting the file (P1-11).
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation(candidate.text) <= indent) {
        endIndex = cursor - 1;
        break;
      }
    }
    // A trailing run of blank/comment lines right before the next dedented
    // construct belongs to that construct, not to this body — trim it so
    // EditSymbol neither swallows the next symbol's header comments nor
    // duplicates trailing comments in the replacement span.
    while (endIndex > headerEnd) {
      const text = lines[endIndex].text.trim();
      if (text && !text.startsWith('#')) break;
      endIndex -= 1;
    }
    const kind: SymbolKind = match[3] === 'class' ? 'class' : 'function';
    matches.push(
      buildMatch(
        {
          name: match[4],
          qualifiedName: match[4],
          kind,
          startLine: lines[startIndex].number,
          endLine: lines[endIndex].number,
          startOffset: lines[startIndex].startOffset,
          endOffset: lines[endIndex].endOffsetWithNewline,
          indent,
        },
        content
      )
    );
  }
  return qualifyNestedSymbols(matches);
}

function findOpeningBrace(content: string, startOffset: number, maxOffset: number): number {
  let quote: '"' | "'" | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  let regex = false;
  let regexCharClass = false;
  const cappedMax = Math.min(maxOffset, content.length);
  for (let index = startOffset; index < cappedMax; index += 1) {
    const char = content[index];
    const next = content[index + 1];
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
    if (regex) {
      if (char === '[' && !isEscaped(content, index)) regexCharClass = true;
      else if (char === ']' && !isEscaped(content, index)) regexCharClass = false;
      else if (char === '/' && !regexCharClass && !isEscaped(content, index)) regex = false;
      continue;
    }
    if (quote) {
      if (char === quote && !isEscaped(content, index)) quote = undefined;
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
    if (char === '/' && canStartRegexLiteral(content, index)) {
      regex = true;
      regexCharClass = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') return index;
  }
  return -1;
}

/** Line text with any trailing `//` comment removed, quote-aware so a `//`
 * inside a string literal is preserved. Single-line heuristic: block comments
 * spanning lines are not tracked (pre-existing limitation). */
function stripJsLineComment(text: string): string {
  let quote: '"' | "'" | '`' | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') return text.slice(0, index);
  }
  return text;
}

function findStatementEnd(lines: LineInfo[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    // Test the code part of the line: a trailing `//` comment after `;`/`}`
    // must not push the statement end into the following symbol, otherwise
    // EditSymbol would swallow it (analogous to the P1-11 Python comment bug).
    if (/[;}]$/.test(stripJsLineComment(lines[index].text).trim())) return index;
  }
  return startIndex;
}

function findMatchingBrace(content: string, openOffset: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  let regex = false;
  let regexCharClass = false;
  for (let index = openOffset; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
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
    if (regex) {
      if (char === '[' && !isEscaped(content, index)) regexCharClass = true;
      else if (char === ']' && !isEscaped(content, index)) regexCharClass = false;
      else if (char === '/' && !regexCharClass && !isEscaped(content, index)) regex = false;
      continue;
    }
    if (quote) {
      if (char === quote && !isEscaped(content, index)) quote = undefined;
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
    if (char === '/' && canStartRegexLiteral(content, index)) {
      regex = true;
      regexCharClass = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
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
  const index = lines.findIndex(
    line => offset >= line.startOffset && offset <= line.endOffsetWithNewline
  );
  return index === -1 ? lines.length - 1 : index;
}

function jsSymbols(content: string): SymbolMatch[] {
  const lines = splitLines(content);
  const matches: SymbolMatch[] = [];
  const patterns: Array<{
    kind: SymbolKind;
    regex: RegExp;
    limitBraceSearchToStatement?: boolean;
  }> = [
    {
      kind: 'function',
      regex: /^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'class',
      regex: /^\s*(?:export\s+default\s+|export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'variable',
      regex:
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
      limitBraceSearchToStatement: true,
    },
    {
      kind: 'method',
      regex:
        /^\s*(?:(?:public|private|protected|static|async|get|set|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::[^{]+)?\{/,
    },
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
      const statementEndIndex = findStatementEnd(lines, index);
      const searchEnd = pattern.limitBraceSearchToStatement
        ? lines[statementEndIndex].endOffsetWithNewline
        : Math.min(content.length, line.startOffset + 5_000);
      const openBrace = findOpeningBrace(content, line.startOffset, searchEnd);
      const bodyEnd = openBrace === -1 ? -1 : findMatchingBrace(content, openBrace);
      const endIndex = bodyEnd === -1 ? statementEndIndex : lineIndexForOffset(lines, bodyEnd);
      matches.push(
        buildMatch(
          {
            name: match[1],
            qualifiedName: match[1],
            kind: pattern.kind,
            startLine: lines[startIndex].number,
            endLine: lines[endIndex].number,
            startOffset: lines[startIndex].startOffset,
            endOffset: lines[endIndex].endOffsetWithNewline,
            indent,
          },
          content
        )
      );
      break;
    }
  }
  return qualifyNestedSymbols(matches);
}

function qualifyNestedSymbols(symbols: SymbolMatch[]): SymbolMatch[] {
  return symbols.map(symbol => {
    const parents = symbols
      .filter(
        candidate =>
          candidate !== symbol &&
          candidate.startOffset <= symbol.startOffset &&
          candidate.endOffset >= symbol.endOffset &&
          candidate.indent < symbol.indent
      )
      .sort((a, b) => a.startOffset - b.startOffset);
    const qualifiedName = [...parents.map(parent => parent.name), symbol.name].join('.');
    const nearestParent = parents[parents.length - 1];
    const kind =
      nearestParent?.kind === 'class' && symbol.kind === 'function' ? 'method' : symbol.kind;
    return { ...symbol, qualifiedName, kind };
  });
}

function symbolsForFile(content: string, filePath: string): SymbolMatch[] | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (['.py', '.pyw', '.pyi'].includes(ext)) return pythonSymbols(content);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext))
    return jsSymbols(content);
  return undefined;
}

function findSymbol(
  content: string,
  filePath: string,
  symbol: string
):
  | { ok: true; match: SymbolMatch }
  | {
      ok: false;
      result: ReturnType<typeof errorResult>;
    } {
  const all = symbolsForFile(content, filePath);
  const relSymbol = symbol.trim();
  if (!all) {
    return {
      ok: false,
      result: errorResult(
        'unsupported_language',
        'ReadSymbol/EditSymbol supports Python, TypeScript, and JavaScript files.'
      ),
    };
  }
  const candidates = all.filter(
    match =>
      match.qualifiedName === relSymbol || (!relSymbol.includes('.') && match.name === relSymbol)
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      result: errorResult('symbol_not_found', `Symbol not found: ${relSymbol}`, {
        symbol: relSymbol,
      }),
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      result: errorResult(
        'ambiguous_symbol',
        `Symbol name is ambiguous: ${relSymbol}. Use a qualified name.`,
        {
          symbol: relSymbol,
          candidates: candidates.map(match => ({
            symbol: match.qualifiedName,
            kind: match.kind,
            startLine: match.startLine,
            endLine: match.endLine,
          })),
        }
      ),
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

export function createReadSymbolTool(cwd: string, options?: ReadSymbolOptions): AgentTool {
  return {
    name: 'ReadSymbol',
    label: 'ReadSymbol',
    description:
      'Read one named function, method, class, or exported variable from a Python/TypeScript/JavaScript file. Prefer this over line-number reads when you know the symbol name.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative source file path' },
        path: { type: 'string', description: 'Alias for file_path' },
        symbol: {
          type: 'string',
          description: 'Symbol name, e.g. "run", "Client.connect", or "_schedule_chat"',
        },
      },
      required: ['symbol'],
      anyOf: [{ required: ['file_path'] }, { required: ['path'] }],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requested = args.file_path ?? args.path;
      if (typeof requested !== 'string' || !requested.trim())
        return errorResult('missing_path', 'ReadSymbol requires file_path');
      if (typeof args.symbol !== 'string' || !args.symbol.trim())
        return errorResult('missing_symbol', 'ReadSymbol requires symbol');
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err)
        );
      }
      const relPath = toWorkspaceRelative(cwd, filePath);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile())
          return errorResult('not_a_file', `Path is not a file: ${relPath}`, { path: relPath });
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
              range: buildRangeDescriptor(
                match.startLine,
                match.text.replace(/\n$/, '').split(/\r?\n/)
              ),
              fullContentCaptured: true,
              partialView: true,
            }),
          }
        );
      } catch (err) {
        return errorResult('read_symbol_failed', err instanceof Error ? err.message : String(err), {
          path: relPath,
        });
      }
    },
  };
}

export function createEditSymbolTool(cwd: string, options?: FileMutationToolOptions): AgentTool {
  return {
    name: 'EditSymbol',
    label: 'EditSymbol',
    description:
      'Replace one named function, method, class, or exported variable in a Python/TypeScript/JavaScript file. ReadSymbol returns the bodyDigest you can pass as expected_body_digest to guard against stale symbol edits.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative source file path' },
        path: { type: 'string', description: 'Alias for file_path' },
        symbol: {
          type: 'string',
          description: 'Symbol name, e.g. "run", "Client.connect", or "_schedule_chat"',
        },
        new_body: {
          type: 'string',
          description: 'Full replacement text for the symbol, including its declaration line',
        },
        expected_body_digest: {
          type: 'string',
          description: 'Optional bodyDigest from ReadSymbol',
        },
        preview_only: { type: 'boolean', default: false },
      },
      required: ['symbol', 'new_body'],
      anyOf: [{ required: ['file_path'] }, { required: ['path'] }],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requested = args.file_path ?? args.path;
      if (typeof requested !== 'string' || !requested.trim())
        return errorResult('missing_path', 'EditSymbol requires file_path');
      if (typeof args.symbol !== 'string' || !args.symbol.trim())
        return errorResult('missing_symbol', 'EditSymbol requires symbol');
      if (typeof args.new_body !== 'string')
        return errorResult('missing_body', 'EditSymbol requires new_body');
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err)
        );
      }
      const relPath = toWorkspaceRelative(cwd, filePath);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile())
          return errorResult('not_a_file', `Path is not a file: ${relPath}`, { path: relPath });
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
        if (
          typeof args.expected_body_digest === 'string' &&
          args.expected_body_digest.trim() &&
          args.expected_body_digest.trim() !== match.bodyDigest
        ) {
          return errorResult(
            'stale_symbol',
            'Symbol digest does not match expected_body_digest. ReadSymbol again before editing.',
            {
              path: relPath,
              symbol: match.qualifiedName,
              expectedBodyDigest: args.expected_body_digest.trim(),
              currentBodyDigest: match.bodyDigest,
              retryable: true,
              suggestedAction: 'read_symbol',
            }
          );
        }
        const edit = createEditBridgeTool(cwd, options);
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
        return errorResult('edit_symbol_failed', err instanceof Error ? err.message : String(err), {
          path: relPath,
        });
      }
    },
  };
}
