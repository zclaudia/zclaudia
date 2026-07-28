import type { MouseEvent, ReactNode } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionStore } from '../../stores/selectionStore';
import { openToolInWorkspace } from '../../utils/workspaceActions';

const HTTP_RE = /^https?:\/\//i;

/**
 * Anchor for chat markdown: plain left-click opens http(s) links in the
 * right-sidebar browser panel; modifier clicks / non-http links keep the
 * default external behavior (target=_blank).
 */
export function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { sendMessage } = useConnection();
  const sessionId = useSelectionStore((s) => s.selectedSessionId);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!href || !HTTP_RE.test(href) || !sessionId) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    // open is idempotent; the server awaits the in-flight open before navigate.
    sendMessage({ type: 'browser_open', sessionId });
    sendMessage({ type: 'browser_navigate', sessionId, url: href });
    openToolInWorkspace(sessionId, 'browser');
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline"
      onClick={onClick}
    >
      {children}
    </a>
  );
}
