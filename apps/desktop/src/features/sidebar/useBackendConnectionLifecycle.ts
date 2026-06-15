import { useEffect, useRef } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSidebarExpansionStore } from '../../stores/sidebarExpansionStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { computeConnectionPlan } from './backendConnectionLifecycle';

/**
 * Drives the lazy backend-connection lifecycle: opens a remote backend when its
 * sidebar row is expanded (or it becomes the foreground), and closes it when
 * collapsed — never touching the local server or connections it did not open.
 * Mount once (in Sidebar).
 */
export function useBackendConnectionLifecycle(): void {
  const { connectServer, disconnectServer, isServerConnected } = useConnection();
  const expandedBackendIds = useSidebarExpansionStore((s) => s.expandedBackendIds);
  const foregroundBackendId = useServerStore((s) => s.activeServerId);
  const localBackendId = useFacadeStore((s) => s.localBackendId);

  const managedRef = useRef<string[]>([]);

  useEffect(() => {
    const plan = computeConnectionPlan({
      expandedBackendIds,
      foregroundBackendId,
      localBackendId,
      managedBackendIds: managedRef.current,
      isConnected: isServerConnected,
    });
    plan.toConnect.forEach((id) => connectServer(id));
    plan.toDisconnect.forEach((id) => disconnectServer(id));
    managedRef.current = plan.nextManaged;
  }, [expandedBackendIds, foregroundBackendId, localBackendId, connectServer, disconnectServer, isServerConnected]);
}
