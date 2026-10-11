import { memo, useContext } from 'react';
import { ChatInterface } from './ChatInterface';
import { WorkspaceNavigationContext } from '../../components/workspace/WorkspaceContext';
import { useSessionRoute } from './hooks/useSessionRoute';
import { useUIStore } from '../../stores/uiStore';

/** Geometry and focus stay outside this streaming content component. */
export const ChatPane = memo(function ChatPane({ sessionId }: { sessionId: string }) {
  const navigation = useContext(WorkspaceNavigationContext);
  const poppedOutLabel = useUIStore(s => s.poppedOutSessions.get(sessionId));
  // The facade has a single desired subscription per session, without ref counts.
  // Workspace chat hosts own streams; App's selected-session owner is disabled.
  useSessionRoute(sessionId, { maintainDesiredState: !poppedOutLabel });
  return <ChatInterface sessionId={sessionId} surface="card" {...navigation} />;
});
