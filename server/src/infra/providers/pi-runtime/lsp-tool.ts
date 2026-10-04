/**
 * LSPTool — thin model-facing surface over the `LanguageServerPort`.
 *
 * The tool itself does no language work: it validates arguments, keeps the
 * file inside the workspace, turns `line + symbol` into a column, delegates to
 * the port and renders the answer. `buildTools` skips it entirely when the
 * port has no server for the workspace, so its description can assume at
 * least one server is listed.
 *
 * Positions are addressed by symbol name rather than column: models count
 * columns poorly (tabs, multi-byte text), but can name the identifier on a
 * line they just read.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readFile } from 'fs/promises';
import * as path from 'path';
import {
  LanguageServerError,
  type LanguageServerInfo,
  type LanguageServerPort,
  type LspQueryAction,
  type LspQueryRequest,
  type LspQueryResult,
} from '../language-server-port.js';
import { agentToolParameters, errorResult, textResult, toolParams } from './tool-common.js';
import { resolveInsideWorkspace } from './workspace-paths.js';

export interface LspToolDeps {
  cwd: string;
  port?: LanguageServerPort;
}

const ACTIONS = [
  'definition',
  'references',
  'hover',
  'incomingCalls',
  'symbols',
  'diagnostics',
] as const;
type ToolAction = (typeof ACTIONS)[number];
const POSITIONAL_ACTIONS = new Set<ToolAction>([
  'definition',
  'references',
  'hover',
  'incomingCalls',
]);
const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_CAP = 200;

export function describeLanguageServers(servers: LanguageServerInfo[]): string {
  if (servers.length === 0) return 'No language server is configured for this workspace.';
  const list = servers
    .map(server => `${server.name} (${server.id}: ${server.languages.join(', ') || 'any'})`)
    .join('; ');
  return `Language servers available for this workspace: ${list}.`;
}

function listServers(port: LanguageServerPort | undefined, cwd: string): LanguageServerInfo[] {
  if (!port) return [];
  try {
    return port.serversFor(cwd);
  } catch {
    return [];
  }
}

function parsePositive(value: unknown, field: string): number | { error: string } {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return { error: `${field} must be a 1-based integer` };
  return num;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 1-based column of the `occurrence`-th `symbol` on `lineText`, matched as a
 * whole identifier. For a dotted name (`config.port`) the column lands on the
 * last segment, which is what definition / references should resolve. JS
 * string indices are UTF-16 code units, the LSP default position encoding.
 */
export function locateSymbol(
  lineText: string,
  symbol: string,
  occurrence = 1
): number | { error: string } {
  const identifierLike = /^[\w$][\w$.]*$/.test(symbol);
  const pattern = identifierLike
    ? new RegExp(`(?<![\\w$])${escapeRegExp(symbol)}(?![\\w$])`, 'g')
    : new RegExp(escapeRegExp(symbol), 'g');
  const starts = [...lineText.matchAll(pattern)].map(match => match.index ?? 0);
  if (starts.length === 0) {
    return { error: `"${symbol}" does not appear on that line: ${lineText.trim().slice(0, 200)}` };
  }
  if (occurrence > starts.length) {
    return {
      error: `"${symbol}" appears ${starts.length} time(s) on that line; occurrence ${occurrence} is out of range`,
    };
  }
  const lastDot = identifierLike ? symbol.lastIndexOf('.') : -1;
  return starts[occurrence - 1] + (lastDot >= 0 ? lastDot + 1 : 0) + 1;
}

async function resolveColumn(
  file: string,
  line: number,
  symbol: string,
  occurrence: number
): Promise<number | { error: string }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const lines = text.split(/\r?\n/);
  if (line > lines.length) return { error: `line ${line} is past the end (${lines.length} lines)` };
  return locateSymbol(lines[line - 1], symbol, occurrence);
}

export function createLspTool(deps: LspToolDeps): AgentTool {
  const { cwd, port } = deps;
  const servers = listServers(port, cwd);
  return {
    name: 'LSPTool',
    label: 'LSPTool',
    description: [
      'Ask the workspace language server about code semantics (compiler-verified, unlike Grep).',
      'Address a position by file + line + symbol (the identifier as written on that line; add occurrence when it appears more than once):',
      '"definition" / "references" / "hover" / "incomingCalls" (who calls this function) take file + line + symbol;',
      '"symbols" lists the symbols of file, or searches by query when file is omitted (covers the projects of files already queried or edited);',
      '"diagnostics" returns the current errors and warnings of file.',
      'Every location carries a one-line preview. Locations marked external are outside the workspace (dependencies, stdlib): Read cannot open them, use hover for their types.',
      'Use Grep or AstGrep for textual or structural search across languages the server does not cover.',
      describeLanguageServers(servers),
    ].join(' '),
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        file: {
          type: 'string',
          description: 'Workspace-relative or absolute path inside the workspace',
        },
        line: { type: 'integer', description: '1-based line (positional actions)' },
        symbol: {
          type: 'string',
          description: 'Identifier on that line to query, e.g. "createServer" or "config.port"',
        },
        occurrence: {
          type: 'integer',
          description: 'Which occurrence of symbol on the line (1-based, default 1)',
        },
        character: {
          type: 'integer',
          description: '1-based column; only when symbol cannot name the position',
        },
        query: { type: 'string', description: 'Symbol name to search (symbols without file)' },
        max_results: { type: 'integer', default: DEFAULT_MAX_RESULTS },
      },
      required: ['action'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
      const args = toolParams(toolCallId, params);
      if (!port) {
        return errorResult('lsp_unavailable', 'No language server is attached to this workspace');
      }
      const action = String(args.action ?? '') as ToolAction;
      if (!ACTIONS.includes(action)) {
        return errorResult('invalid_action', `action must be one of ${ACTIONS.join(', ')}`, {
          action,
        });
      }
      const maxResults = Math.max(
        1,
        Math.min(
          Number(args.max_results ?? DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS,
          MAX_RESULTS_CAP
        )
      );
      const fileArg = typeof args.file === 'string' && args.file.trim() ? args.file.trim() : '';
      const queryArg = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : '';

      let portAction: LspQueryAction;
      if (action === 'symbols') {
        if (!fileArg && !queryArg) {
          return errorResult('missing_target', 'symbols requires file or query', { action });
        }
        portAction = fileArg ? 'documentSymbols' : 'workspaceSymbols';
      } else {
        if (!fileArg) return errorResult('missing_file', `${action} requires file`, { action });
        portAction = action;
      }

      let file: string | undefined;
      if (fileArg) {
        try {
          file = resolveInsideWorkspace(cwd, fileArg);
        } catch (err) {
          return errorResult(
            'path_outside_workspace',
            err instanceof Error ? err.message : String(err),
            { action, file: fileArg }
          );
        }
      }

      const request: LspQueryRequest = { cwd, action: portAction, maxResults };
      if (file) request.file = file;
      if (queryArg && portAction === 'workspaceSymbols') request.query = queryArg;
      if (POSITIONAL_ACTIONS.has(action)) {
        const line = parsePositive(args.line, 'line');
        if (typeof line !== 'number')
          return errorResult('invalid_position', line.error, { action });
        const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
        let character: number | { error: string };
        if (symbol) {
          const occurrence =
            args.occurrence === undefined ? 1 : parsePositive(args.occurrence, 'occurrence');
          if (typeof occurrence !== 'number') {
            return errorResult('invalid_position', occurrence.error, { action });
          }
          character = await resolveColumn(file!, line, symbol, occurrence);
          if (typeof character !== 'number') {
            return errorResult('symbol_not_found', character.error, { action, line, symbol });
          }
        } else if (args.character !== undefined) {
          character = parsePositive(args.character, 'character');
          if (typeof character !== 'number') {
            return errorResult('invalid_position', character.error, { action });
          }
        } else {
          return errorResult('invalid_position', `${action} requires line + symbol`, { action });
        }
        request.line = line;
        request.character = character;
      }

      try {
        const result = await port.query(request, signal);
        const summary = summarize(result);
        // The model sees the tool-level action ("symbols"), not the port's
        // documentSymbols / workspaceSymbols split.
        const payload = { ...result, action, file: file ? path.relative(cwd, file) : undefined };
        return textResult(JSON.stringify(payload, null, 2), { ok: true, action, ...summary });
      } catch (err) {
        if (err instanceof LanguageServerError) {
          return errorResult(err.code, err.message, { action });
        }
        return errorResult('lsp_query_failed', err instanceof Error ? err.message : String(err), {
          action,
        });
      }
    },
  };
}

function summarize(result: LspQueryResult) {
  switch (result.action) {
    case 'definition':
    case 'references':
      return { total: result.locations.length, truncated: result.truncated ?? false };
    case 'documentSymbols':
    case 'workspaceSymbols':
      return { total: result.symbols.length, truncated: result.truncated ?? false };
    case 'diagnostics':
      return {
        total: result.diagnostics.length,
        state: result.state,
        truncated: result.truncated ?? false,
      };
    case 'incomingCalls':
      return { total: result.calls.length, truncated: result.truncated ?? false };
    case 'hover':
      return { total: result.contents ? 1 : 0 };
  }
}
