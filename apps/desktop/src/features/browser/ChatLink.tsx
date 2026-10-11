import type { MouseEvent, ReactNode } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionStore } from '../../stores/selectionStore';
import { openToolInWorkspace } from '../../actions/workspaceActions';
import { isPanelAvailable } from '../../actions/openPanel';
import { useChatActionsOptional } from '../chat';

const HTTP_RE = /^https?:\/\//i;

/**
 * Anchor for chat markdown: plain left-click opens http(s) links in the
 * right-sidebar browser panel; modifier clicks / non-http links keep the
 * default external behavior (target=_blank).
 *
 * Falls through to the default anchor behavior (no interception) when the
 * browser panel isn't available on this platform/surface (e.g. mobile,
 * where panels render through BottomPanel and the browser panel is
 * desktop-only) or when disconnected from the backend (nothing to send the
 * open/navigate messages to).
 */
export function ChatLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { sendMessage, sendToServer, isConnected } = useConnection();
  const chat = useChatActionsOptional();
  const boundSessionId = chat?.sessionId;
  const sessionId = useSelectionStore(s => boundSessionId ?? s.selectedSessionId);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!href || !HTTP_RE.test(href) || !sessionId) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!(chat?.isConnected ?? isConnected)) return;
    if (!isPanelAvailable('browser')) return;
    e.preventDefault();
    // open is idempotent; the server awaits the in-flight open before navigate.
    if (chat?.backendId) {
      sendToServer(chat.backendId, { type: 'browser_open', sessionId });
      sendToServer(chat.backendId, { type: 'browser_navigate', sessionId, url: href });
      openToolInWorkspace(sessionId, 'browser', { backendId: chat.backendId });
    } else {
      sendMessage({ type: 'browser_open', sessionId });
      sendMessage({ type: 'browser_navigate', sessionId, url: href });
      openToolInWorkspace(sessionId, 'browser');
    }
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
