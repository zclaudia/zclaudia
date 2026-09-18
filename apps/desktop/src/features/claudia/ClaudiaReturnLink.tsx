import { Button } from '../../components/ui/Button';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { parseBackendId } from '../../stores/gatewayStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

export function ClaudiaReturnLink({
  sessionId,
  isMobile,
}: {
  sessionId: string;
  isMobile: boolean;
}) {
  const target = useClaudiaStore(s => s.returnTarget);
  const serverId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const backendId = resolveCanonicalBackendId(
    serverId ? parseBackendId(serverId) : null,
    localBackendId
  );
  if (!target || target.backendId !== backendId || target.sessionId !== sessionId) return null;
  return (
    <div className="shrink-0 border-b border-border px-3 py-1">
      <Button
        size="sm"
        onClick={() => {
          useProjectStore.getState().selectProject(target.projectId);
          useClaudiaStore
            .getState()
            .setActiveThread(target.backendId, target.projectId, target.threadId);
          if (isMobile) useClaudiaStore.getState().setExpanded(true);
          else useTopLevelViewStore.getState().openClaudia();
        }}
      >
        Return to Claudia discussion
      </Button>
    </div>
  );
}
