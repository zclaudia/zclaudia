/**
 * MCP OAuth Login Modal (backend-scoped)
 *
 * Moved from the old settings MCP Servers tab's component. The caller starts the
 * OAuth session (startMcpOAuthForBackend) and passes it in; this modal polls
 * for completion and cancels the session on close. The shell is the shared
 * Modal (safe-area, Android back, full-screen sheet on mobile).
 */

import { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useIsMobile } from '../../hooks/useMediaQuery';
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
  const isMobile = useIsMobile();

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
    <Modal
      open
      onClose={() => void handleClose()}
      ariaLabel="MCP OAuth Login"
      title="MCP OAuth Login"
      placement="center"
      size="md"
      zClassName="z-50"
      mobileFullscreen
      isMobile={isMobile}
      dismissOnBackdrop={false}
      dismissOnEscape={false}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleClose()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="px-4 py-4">
        <p className="text-sm text-muted-foreground">
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
      </div>
    </Modal>
  );
}
