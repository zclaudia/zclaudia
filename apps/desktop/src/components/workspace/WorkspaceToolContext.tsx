import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { WorkspaceVisibilityContext } from './WorkspaceContext';

export interface WorkspaceToolValue {
  sessionId: string;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
  backendId?: string;
}

export const WorkspaceToolContext = createContext<WorkspaceToolValue | null>(null);
export const useWorkspaceTool = () => useContext(WorkspaceToolContext);

/** Resolve global singleton tools against their visible pane's bound chat. */
export function WorkspaceToolProvider({
  sessionId,
  projectId,
  projectRoot,
  workingDirectory,
  backendId,
  toolId,
  visible,
  children,
}: WorkspaceToolValue & { toolId?: string; visible: boolean; children: ReactNode }) {
  const value = useMemo(
    () => ({ sessionId, projectId, projectRoot, workingDirectory, backendId }),
    [sessionId, projectId, projectRoot, workingDirectory, backendId]
  );
  useEffect(() => {
    if (!visible || toolId !== 'draft') return;
    const draft = useDraftEditorStore.getState();
    if (draft.activeSessionId !== sessionId) void draft.openEditor(sessionId);
  }, [sessionId, toolId, visible]);

  useEffect(() => {
    if (!visible || toolId !== 'file-viewer' || !projectRoot) return;
    const viewer = useFileViewerStore.getState();
    if (viewer.isOpen && viewer.projectRoot && viewer.projectRoot !== projectRoot) viewer.close();
  }, [projectRoot, toolId, visible]);

  return (
    <WorkspaceToolContext.Provider value={value}>
      <WorkspaceVisibilityContext.Provider value={visible}>{children}</WorkspaceVisibilityContext.Provider>
    </WorkspaceToolContext.Provider>
  );
}
