/**
 * LSPTool — thin model-facing surface over the `LanguageServerPort`.
 *
 * The tool itself does no language work: it validates arguments, keeps the
 * file inside the workspace, delegates to the port and renders the answer.
 * `buildTools` skips it entirely when the port has no server for the
 * workspace, so its description can assume at least one server is listed.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import * as path from 'path';
import {
  LanguageServerError,
  type LanguageServerInfo,
  type LanguageServerPort,
  type LspQueryAction,
  type LspQueryRequest,
} from '../language-server-port.js';
import { agentToolParameters, errorResult, textResult, toolParams } from './tool-common.js';
import { resolveInsideWorkspace } from './workspace-paths.js';

export interface LspToolDeps {
  cwd: string;
  port?: LanguageServerPort;
}

const ACTIONS = ['definition', 'references', 'hover', 'symbols', 'diagnostics'] as const;
type ToolAction = (typeof ACTIONS)[number];
const POSITIONAL_ACTIONS = new Set<ToolAction>(['definition', 'references', 'hover']);
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

function parsePosition(value: unknown, field: string): number | { error: string } {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return { error: `${field} must be a 1-based integer` };
  return num;
}

export function createLspTool(deps: LspToolDeps): AgentTool {
  const { cwd, port } = deps;
  const servers = listServers(port, cwd);
  return {
    name: 'LSPTool',
    label: 'LSPTool',
    description: [
      'Ask the workspace language server about code semantics (compiler-verified, unlike Grep):',
      '"definition" / "references" / "hover" take file + line + character (1-based, as shown by Read);',
      '"symbols" lists the symbols of file, or searches the workspace by query when file is omitted;',
      '"diagnostics" returns the current errors and warnings of file.',
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
        line: { type: 'integer', description: '1-based line (definition / references / hover)' },
        character: {
          type: 'integer',
          description: '1-based column (definition / references / hover)',
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
        const line = parsePosition(args.line, 'line');
        if (typeof line !== 'number')
          return errorResult('invalid_position', line.error, { action });
        const character = parsePosition(args.character, 'character');
        if (typeof character !== 'number') {
          return errorResult('invalid_position', character.error, { action });
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

function summarize(result: Awaited<ReturnType<LanguageServerPort['query']>>) {
  switch (result.action) {
    case 'definition':
    case 'references':
      return { total: result.locations.length, truncated: result.truncated ?? false };
    case 'documentSymbols':
    case 'workspaceSymbols':
      return { total: result.symbols.length, truncated: result.truncated ?? false };
    case 'diagnostics':
      return { total: result.diagnostics.length, truncated: result.truncated ?? false };
    case 'hover':
      return { total: result.contents ? 1 : 0 };
  }
}
