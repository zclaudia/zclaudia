import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FileDiagnosticEntry,
  FileLanguageServerDiagnostics,
} from '@zclaudia/shared/core/language-servers';
import {
  acquireLanguageServerViewerLease,
  getFileLanguageServerDiagnostics,
  releaseLanguageServerViewerLease,
  renewLanguageServerViewerLease,
} from '../../services/api';

/** While a server starts: poll this often, for at most this long. */
const STARTING_POLL_MS = 2_000;
const STARTING_POLL_LIMIT = 45;
/** Renew well inside the backend's 90s lease TTL. */
const LEASE_RENEW_MS = 60_000;

export type FileDiagnosticsState = FileLanguageServerDiagnostics['state'] | 'loading';

export interface FileDiagnosticsResult {
  state: FileDiagnosticsState;
  serverName: string | null;
  /** Errors and warnings only, by line. */
  diagnostics: FileDiagnosticEntry[];
  /** Start the workspace's servers and keep them running while the viewer is open. */
  startChecking: () => void;
}

/**
 * Diagnostics for the file in the viewer. Passive by default: shown only
 * when the workspace's language server is already running (an agent run, or
 * within its idle window). `startChecking` takes a viewer lease, so the
 * server starts and stays up until the viewer closes; the backend lets the
 * lease lapse if renewals stop (closed window, lost connection).
 */
export function useFileDiagnostics(params: {
  projectRoot: string;
  filePath: string | null;
  backendId: string | null;
  /** Changes when the file's content changes (its mtime). */
  version: number | null;
}): FileDiagnosticsResult {
  const { projectRoot, filePath, backendId, version } = params;
  const [result, setResult] = useState<FileLanguageServerDiagnostics | null>(null);
  // The workspace (on its backend) a lease is held for: a lease never carries
  // over to another workspace or backend.
  const workspaceKey = `${backendId ?? ''}\0${projectRoot}`;
  const [leasedFor, setLeasedFor] = useState<string | null>(null);
  const leased = leasedFor === workspaceKey;
  const leaseRef = useRef<string | null>(null);

  // Fetch on file / content change, then poll while the server starts.
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      attempts += 1;
      let next: FileLanguageServerDiagnostics;
      try {
        next = await getFileLanguageServerDiagnostics({
          projectRoot,
          relativePath: filePath,
          backendId,
        });
      } catch {
        // An older backend without the endpoint, or offline: show nothing.
        next = { state: 'unavailable', server: null, diagnostics: [] };
      }
      if (cancelled) return;
      setResult(next);
      const waiting = next.state === 'starting' || (leased && next.state === 'not_running');
      if (waiting && attempts < STARTING_POLL_LIMIT) {
        timer = setTimeout(() => void load(), STARTING_POLL_MS);
      }
    };
    void load();
    const onFocus = () => {
      attempts = 0;
      clearTimeout(timer);
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [projectRoot, filePath, backendId, version, leased]);

  // A lease belongs to one workspace on one backend; renew it, release it on leave.
  useEffect(() => {
    if (!leased) return;
    const interval = setInterval(() => {
      const leaseId = leaseRef.current;
      if (!leaseId) return;
      renewLanguageServerViewerLease(leaseId, backendId).catch(() => {
        // Lapsed (backend restarted): offer "Check types" again.
        leaseRef.current = null;
        setLeasedFor(null);
      });
    }, LEASE_RENEW_MS);
    return () => {
      clearInterval(interval);
      const leaseId = leaseRef.current;
      leaseRef.current = null;
      if (leaseId) void releaseLanguageServerViewerLease(leaseId, backendId).catch(() => undefined);
    };
  }, [leased, projectRoot, backendId]);

  const startChecking = useCallback(() => {
    if (leaseRef.current) return;
    setResult(current => (current ? { ...current, state: 'starting' } : current));
    acquireLanguageServerViewerLease(projectRoot, backendId)
      .then(lease => {
        leaseRef.current = lease.leaseId;
        setLeasedFor(workspaceKey);
      })
      .catch(() => {
        setResult(current => (current ? { ...current, state: 'not_running' } : current));
      });
  }, [projectRoot, backendId, workspaceKey]);

  if (!filePath) {
    return { state: 'unavailable', serverName: null, diagnostics: [], startChecking };
  }
  return {
    state: result?.state ?? 'loading',
    serverName: result?.server?.name ?? null,
    diagnostics: (result?.diagnostics ?? []).filter(
      diagnostic => diagnostic.severity === 'error' || diagnostic.severity === 'warning'
    ),
    startChecking,
  };
}
