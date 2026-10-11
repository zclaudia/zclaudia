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
    if (!sessionId) {
      if (draft.activeSessionId) void draft.closeEditor();
      return;
    }
    if (draft.activeSessionId !== sessionId) void draft.openEditor(sessionId);
  }, [sessionId, toolId, visible]);

  useEffect(() => {
    if (!visible || toolId !== 'file-viewer' || !projectRoot) return;
    const viewer = useFileViewerStore.getState();
    if (viewer.isOpen && viewer.projectRoot && viewer.projectRoot !== projectRoot) viewer.close();
    if (backendId && viewer.backendId !== backendId) {
      if (viewer.projectRoot === projectRoot && viewer.filePath && !viewer.backendId) {
        // Adopt legacy unscoped references without mixing their cached payload.
        viewer.openFile(projectRoot, viewer.filePath, viewer.targetLine ?? undefined, viewer.targetEndLine ?? undefined, backendId);
      } else {
        viewer.backToTree();
        useFileViewerStore.setState({ projectRoot, backendId });
      }
    }
  }, [projectRoot, backendId, toolId, visible]);

  return (
    <WorkspaceToolContext.Provider value={value}>
      <WorkspaceVisibilityContext.Provider value={visible}>{children}</WorkspaceVisibilityContext.Provider>
    </WorkspaceToolContext.Provider>
  );
}
