import { readFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { FileChangeNotifier } from './file-change-notifier.js';
import type {
  WriteDiagnosticsProvider,
  WriteLifecycleDiagnostic,
  WriteLifecycleInput,
} from './write-lifecycle.js';

export interface LspTransport {
  notify(method: string, params: unknown): Promise<void> | void;
  onNotification?(method: string, handler: (params: unknown) => void): () => void;
}

export interface LspDiagnosticsAdapterOptions {
  cwd: string;
  transport: LspTransport;
  diagnosticsTimeoutMs?: number;
  languageIdForPath?: (filePath: string) => string;
}

export interface LspDiagnosticsAdapter {
  diagnosticsProvider: WriteDiagnosticsProvider;
  fileChangeNotifier: FileChangeNotifier;
  dispose(): void;
}

type LspDiagnostic = {
  range?: { start?: { line?: number; character?: number } };
  severity?: number;
  message?: string;
  source?: string;
};

type PublishDiagnosticsParams = {
  uri?: string;
  diagnostics?: LspDiagnostic[];
};

const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 500;

function defaultLanguageIdForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.json') return 'json';
  return 'plaintext';
}

export function filePathToUri(filePath: string): string {
  // pathToFileURL percent-encodes `#`, `%`, `?` etc. and produces correct
  // Windows drive URIs; the previous `new URL('file://' + ...)` broke on both
  // (`#`/`?` start URL fragments/queries, `%` corrupts percent-decoding).
  return pathToFileURL(path.resolve(filePath)).href;
}

function uriToPath(uri: string): string {
  return fileURLToPath(uri);
}

function toSeverity(severity: number | undefined): WriteLifecycleDiagnostic['severity'] {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  return 'info';
}

function toRelativePath(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}

function mapDiagnostics(
  cwd: string,
  uri: string,
  diagnostics: LspDiagnostic[]
): WriteLifecycleDiagnostic[] {
  const filePath = uriToPath(uri);
  const relPath = toRelativePath(cwd, filePath);
  return diagnostics.map(diagnostic => ({
    path: relPath,
    line: (diagnostic.range?.start?.line ?? 0) + 1,
    column: (diagnostic.range?.start?.character ?? 0) + 1,
    severity: toSeverity(diagnostic.severity),
    message: diagnostic.message ?? '',
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
  }));
}

export function createLspDiagnosticsAdapter(
  options: LspDiagnosticsAdapterOptions
): LspDiagnosticsAdapter {
  const diagnosticsByUri = new Map<
    string,
    { diagnostics: WriteLifecycleDiagnostic[]; saveSeq: number }
  >();
  const waitersByUri = new Map<string, Array<(diagnostics: WriteLifecycleDiagnostic[]) => void>>();
  const languageIdForPath = options.languageIdForPath ?? defaultLanguageIdForPath;
  const timeoutMs = Math.max(1, options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS);
  const openedUris = new Set<string>();
  // LSP document version sent with didOpen/didChange (must increase per change).
  const versionByUri = new Map<string, number>();
  // Monotonic per-document save counter. Cached diagnostics are stamped with
  // the counter value at publish time; a cache entry older than the latest
  // save is stale and must not be served without waiting for a fresh publish.
  const saveSeqByUri = new Map<string, number>();

  const unsubscribe = options.transport.onNotification?.('textDocument/publishDiagnostics', raw => {
    const params = raw as PublishDiagnosticsParams;
    if (!params.uri) return;
    let diagnostics: WriteLifecycleDiagnostic[];
    try {
      diagnostics = mapDiagnostics(options.cwd, params.uri, params.diagnostics ?? []);
    } catch {
      return; // non-file or malformed URI (e.g. untitled:) — not a workspace document
    }
    // publishDiagnostics carries no reliable document version, so attribute
    // the arrival to the most recent save seen for this document. A save that
    // lands after this stamp marks the entry stale (served only as the
    // timeout fallback below).
    diagnosticsByUri.set(params.uri, {
      diagnostics,
      saveSeq: saveSeqByUri.get(params.uri) ?? 0,
    });
    const waiters = waitersByUri.get(params.uri) ?? [];
    waitersByUri.delete(params.uri);
    for (const resolve of waiters) resolve(diagnostics);
  });

  async function notifyDocumentSaved(
    input: Pick<WriteLifecycleInput, 'absolutePath' | 'path'>
  ): Promise<void> {
    const uri = filePathToUri(input.absolutePath);
    const text = await readFile(input.absolutePath, 'utf8');
    const version = (versionByUri.get(uri) ?? 0) + 1;
    versionByUri.set(uri, version);
    saveSeqByUri.set(uri, (saveSeqByUri.get(uri) ?? 0) + 1);
    if (!openedUris.has(uri)) {
      openedUris.add(uri);
      await options.transport.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: languageIdForPath(input.absolutePath),
          version,
          text,
        },
      });
    } else {
      // didOpen may only be sent once per document; subsequent saves report
      // the new full text with an incremented document version.
      await options.transport.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    await options.transport.notify('textDocument/didSave', {
      textDocument: { uri },
      text,
    });
  }

  const fileChangeNotifier: FileChangeNotifier = {
    notifyFileChanged: async event => {
      await notifyDocumentSaved(event);
    },
  };

  const diagnosticsProvider: WriteDiagnosticsProvider = async input => {
    const uri = filePathToUri(input.absolutePath);
    const latestSave = saveSeqByUri.get(uri) ?? 0;
    const cached = diagnosticsByUri.get(uri);
    // Serve the cache only when it was published in response to the latest
    // save; otherwise wait for the server to publish fresh diagnostics.
    if (cached && cached.saveSeq >= latestSave) return cached.diagnostics;
    return await new Promise<WriteLifecycleDiagnostic[]>(resolve => {
      const waiter = (diagnostics: WriteLifecycleDiagnostic[]) => {
        clearTimeout(timer);
        resolve(diagnostics);
      };
      const timer = setTimeout(() => {
        // Timeout fallback: serve whatever is cached (possibly stale) and
        // drop the waiter so it cannot resolve an already-settled promise or
        // accumulate across saves.
        waitersByUri.set(
          uri,
          (waitersByUri.get(uri) ?? []).filter(candidate => candidate !== waiter)
        );
        resolve(diagnosticsByUri.get(uri)?.diagnostics ?? []);
      }, timeoutMs);
      const waiters = waitersByUri.get(uri) ?? [];
      waiters.push(waiter);
      waitersByUri.set(uri, waiters);
    });
  };

  return {
    diagnosticsProvider,
    fileChangeNotifier,
    dispose: () => {
      unsubscribe?.();
      // Close every opened document so documents don't leak in the server.
      for (const uri of openedUris) {
        try {
          void options.transport.notify('textDocument/didClose', { textDocument: { uri } });
        } catch {
          /* best-effort shutdown */
        }
      }
      openedUris.clear();
      versionByUri.clear();
      saveSeqByUri.clear();
      waitersByUri.clear();
      diagnosticsByUri.clear();
    },
  };
}
