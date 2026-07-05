/**
 * MCP OAuth Login Modal (backend-scoped)
 *
 * Moved from the settings McpServerSettings component. The caller starts the
 * OAuth session (startMcpOAuthForBackend) and passes it in; this modal polls
 * for completion and cancels the session on close.
 */

import { useState, useEffect } from 'react';
import { cancelMcpOAuthForBackend, pollMcpOAuthStatusForBackend } from '../../services/api';
import type { McpOAuthStartResult } from '../../services/api';

export interface McpOAuthLoginModalProps {
  backendId: string;
  serverName: string;
  session: McpOAuthStartResult;
  onClose: () => void;
  onSuccess: () => void;
}

export function McpOAuthLoginModal({
  backendId,
  serverName,
  session,
  onClose,
  onSuccess,
}: McpOAuthLoginModalProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await pollMcpOAuthStatusForBackend(backendId, serverName, session.sessionId);
        if (stopped) return;
        if (status.state === 'success') {
          onSuccess();
          return;
        }
        if (status.state === 'error') {
          setError(status.message);
          return;
        }
        if (status.state === 'cancelled') {
          setError('OAuth login cancelled');
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [backendId, serverName, session, onSuccess]);

  const handleClose = async () => {
    try {
      await cancelMcpOAuthForBackend(backendId, serverName, session.sessionId);
    } catch {
      // ignore cancellation errors
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-lg font-medium text-foreground">MCP OAuth Login</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Authenticate {serverName} and return here when the browser flow is complete.
        </p>
        {session.method === 'browser' && (
          <div className="mt-3 text-sm">
            <p>Waiting for browser authorization callback...</p>
            <code className="mt-2 block break-all rounded bg-secondary p-2 text-xs">
              {session.authUrl}
            </code>
          </div>
        )}
        {session.method === 'device_code' && (
          <div className="mt-3 text-sm">
            <a
              href={session.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Open verification page
            </a>
            <div className="mt-2 rounded bg-secondary p-3 text-center font-mono text-2xl tracking-widest">
              {session.userCode}
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
