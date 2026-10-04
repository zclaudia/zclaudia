/**
 * In-memory LSP server for tests: speaks real JSON-RPC over PassThrough
 * streams. Every line containing `ERR:` becomes an error diagnostic whose
 * message is the rest of that line.
 */
import { PassThrough } from 'stream';
import {
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

  connection.onRequest('initialize', params => {
    record('initialize')(params);
    return {
      capabilities: { textDocumentSync: options.wantsSave ? { change: 1, save: true } : 1 },
    };
  });
  connection.onRequest('shutdown', () => {
    record('shutdown')(undefined);
    return null;
  });
  connection.onNotification('exit', () => terminate(0));
  connection.onNotification('initialized', record('initialized'));
  connection.onNotification('textDocument/didOpen', (params: any) => {
    record('didOpen')(params);
    publish(params.textDocument.uri, params.textDocument.text);
  });
  connection.onNotification('textDocument/didChange', (params: any) => {
    record('didChange')(params);
    publish(params.textDocument.uri, params.contentChanges[0].text);
  });
  connection.onNotification('textDocument/didSave', record('didSave'));
  connection.onNotification('textDocument/didClose', record('didClose'));
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
