import { createContext, useContext } from 'react';

export interface WorkspacePaneValue {
  workspaceId: string;
  paneId: string;
  projectId?: string;
  chatSessionId?: string;
}

export const WorkspacePaneContext = createContext<WorkspacePaneValue | null>(null);
export const useWorkspacePane = () => useContext(WorkspacePaneContext);

export interface WorkspaceNavigationValue {
  /** Embedded consumers update local workspace focus without navigating the app. */
  syncSelection?: boolean;
  onReturnToDashboard?: (projectId: string) => void;
  onOpenSidebar?: () => void;
}

export const WorkspaceNavigationContext = createContext<WorkspaceNavigationValue>({});
/** Visibility belongs to the host, independently of the global panel registry. */
export const WorkspaceVisibilityContext = createContext(true);
export const useWorkspaceVisible = () => useContext(WorkspaceVisibilityContext);
