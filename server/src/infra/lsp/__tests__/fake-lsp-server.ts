/**
 * In-memory LSP server for tests: speaks real JSON-RPC over PassThrough
 * streams. Every line containing `ERR:` becomes an error diagnostic whose
 * message is the rest of that line.
 */
import { PassThrough } from 'stream';
import {
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
} from 'vscode-languageserver-protocol/node';
import type { LanguageServerTransport } from '../types.js';

export interface FakeServerOptions {
  publishDelayMs?: number;
  /** Never publish diagnostics (to exercise timeouts). */
  silent?: boolean;
  /** Ask the client for didSave. */
  wantsSave?: boolean;
  /** Extra / overriding server capabilities. */
  capabilities?: Record<string, unknown>;
  /** Delay before `initialize` answers (slow start-up). */
  initializeDelayMs?: number;
  /** workspace/symbol finds nothing. */
  noWorkspaceSymbols?: boolean;
}

export interface FakeServer {
  transport: LanguageServerTransport;
  received: Array<{ method: string; params: any }>;
  crash(): void;
}

export function diagnoseText(text: string) {
  return text.split('\n').flatMap((line, index) => {
    const at = line.indexOf('ERR:');
    if (at < 0) return [];
    return [
      {
        range: { start: { line: index, character: at }, end: { line: index, character: at + 4 } },
        severity: 1,
        source: 'fake',
        message: line.slice(at + 4).trim(),
      },
    ];
  });
}

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const connection = createProtocolConnection(
    new StreamMessageReader(toServer),
    new StreamMessageWriter(toClient)
  );
  const received: FakeServer['received'] = [];
  let resolveExit!: (value: { code: number | null; signal: string | null }) => void;
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    resolveExit = resolve;
  });
  let gone = false;
  const terminate = (code: number | null) => {
    if (gone) return;
    gone = true;
    connection.dispose();
    toClient.end();
    resolveExit({ code, signal: null });
  };
  const publish = (uri: string, text: string) => {
    if (options.silent) return;
    setTimeout(() => {
      if (gone) return;
      void connection.sendNotification('textDocument/publishDiagnostics', {
        uri,
        diagnostics: diagnoseText(text),
      });
    }, options.publishDelayMs ?? 5);
  };
  const record = (method: string) => (params: any) => received.push({ method, params });

  connection.onRequest('initialize', async params => {
    record('initialize')(params);
    if (options.initializeDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.initializeDelayMs));
    }
    return {
      capabilities: {
        textDocumentSync: options.wantsSave ? { change: 1, save: true } : 1,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        callHierarchyProvider: true,
        ...options.capabilities,
      },
    };
  });

  // Query handlers over the documents the client opened (uri -> text).
  const texts = new Map<string, string>();
  const range = (line: number, character = 0, length = 3) => ({
    start: { line, character },
    end: { line, character: character + length },
  });
  const linesWith = (uri: string, needle: string) =>
    (texts.get(uri) ?? '')
      .split('\n')
      .flatMap((line, index) => (line.includes(needle) ? [index] : []));
  connection.onRequest('textDocument/definition', (params: any) => {
    record('definition')(params);
    return { uri: params.textDocument.uri, range: range(0) };
  });
  connection.onRequest('textDocument/references', (params: any) => {
    record('references')(params);
    return linesWith(params.textDocument.uri, 'REF').map(line => ({
      uri: params.textDocument.uri,
      range: range(line),
    }));
  });
  connection.onRequest('textDocument/hover', (params: any) => {
    record('hover')(params);
    if ((texts.get(params.textDocument.uri) ?? '').includes('THROW')) {
      throw new ResponseError(
        1,
        '<syntax> Fake Server Error\nNo Project.\nError: No Project.\n    at x (y.js:1:1)'
      );
    }
    const { line, character } = params.position;
    return { contents: { kind: 'markdown', value: `hover ${line}:${character}` } };
  });
  connection.onRequest('textDocument/documentSymbol', (params: any) => {
    record('documentSymbol')(params);
    return [
      {
        name: 'Outer',
        kind: 5,
        range: range(0),
        selectionRange: range(0),
        children: [{ name: 'inner', kind: 6, range: range(1), selectionRange: range(1, 2) }],
      },
    ];
  });
  connection.onRequest('workspace/symbol', (params: any) => {
    record('workspaceSymbol')(params);
    if (texts.size === 0) throw new ResponseError(1, 'No Project.');
    if (options.noWorkspaceSymbols) return [];
    return [...texts.keys()].map(uri => ({
      name: params.query,
      kind: 12,
      location: { uri, range: range(0) },
    }));
  });
  connection.onRequest('textDocument/prepareCallHierarchy', (params: any) => [
    {
      name: 'callee',
      kind: 12,
      uri: params.textDocument.uri,
      range: range(0),
      selectionRange: range(0),
    },
  ]);
  connection.onRequest('callHierarchy/incomingCalls', (params: any) => [
    {
      from: {
        name: 'caller',
        kind: 12,
        uri: params.item.uri,
        range: range(2),
        selectionRange: range(2),
      },
      fromRanges: [range(3, 4)],
    },
  ]);
  connection.onRequest('shutdown', () => {
    record('shutdown')(undefined);
    return null;
  });
  connection.onNotification('exit', () => terminate(0));
  connection.onNotification('initialized', record('initialized'));
  connection.onNotification('textDocument/didOpen', (params: any) => {
    record('didOpen')(params);
    texts.set(params.textDocument.uri, params.textDocument.text);
    publish(params.textDocument.uri, params.textDocument.text);
  });
  connection.onNotification('textDocument/didChange', (params: any) => {
    record('didChange')(params);
    texts.set(params.textDocument.uri, params.contentChanges[0].text);
    publish(params.textDocument.uri, params.contentChanges[0].text);
  });
  connection.onNotification('textDocument/didSave', record('didSave'));
  connection.onNotification('textDocument/didClose', (params: any) => {
    record('didClose')(params);
    texts.delete(params.textDocument.uri);
  });
  connection.listen();

  return {
    received,
    crash: () => terminate(1),
    transport: {
      reader: toClient,
      writer: toServer,
      exited,
      kill: () => terminate(null),
      pid: 4242,
      stderrTail: () => 'fake server stderr',
    },
  };
}
