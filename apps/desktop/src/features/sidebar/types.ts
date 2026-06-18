import type { Session, GitWorktree, Project, AgentProfileConfig } from '@zclaudia/shared';
import type { SearchSidebarState } from './useSearchSidebar';

/** Agent profile meta shape used within sidebar (subset of full agent profile) */
export type SidebarAgent = Pick<AgentProfileConfig, 'id' | 'name' | 'isDefault'>;

/** Agent phase info from supervision store */
export interface AgentPhaseInfo {
  phase?: string;
  mainSessionId?: string;
}

/** Props for SidebarSearch */
export interface SidebarSearchProps {
  search: SearchSidebarState;
  isMobile?: boolean;
  sessions: Session[];
  onResultSelect: (sessionId: string, messageId: string, ownerBackendId?: string) => void;
}

/** Props for SearchModal (desktop centered command-palette search) */
export interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  search: SearchSidebarState;
  sessions: Session[];
  onResultSelect: (sessionId: string, messageId: string, ownerBackendId?: string) => void;
}

/** Props for SidebarHeader (desktop only) */
export interface SidebarHeaderProps {
  onToggle: () => void;
}

/** Props for MobileSidebarHeader */
export interface MobileSidebarHeaderProps {
  onClose?: () => void;
  onOpenNotifications?: () => void;
  isNotificationsOpen: boolean;
  notificationUnreadCount: number;
  isClaudiaExpanded: boolean;
  setClaudiaExpanded: (expanded: boolean) => void;
  hasClaudiaPermissionPending: boolean;
  hasClaudiaUnread: boolean;
  hasClaudiaRunning: boolean;
}

/** Props for ProjectListItem */
export interface ProjectListItemProps {
  project: Project;
  isExpanded: boolean;
  onToggle: () => void;
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onOpenDashboard?: (projectId: string) => void;
  hasPendingForSession: (sessionId: string) => boolean;
  activeRunSessionIds: Set<string>;
  getProviderName: (session: Session) => string | undefined;
  getWorktreeBranch: (session: Session, project: Project | undefined) => string | undefined;
  supervisorAgent?: AgentPhaseInfo;
  worktrees: GitWorktree[];
  expandedWorktrees: Set<string>;
  onToggleWorktree: (key: string) => void;
  onDeleteWorktree: (projectId: string, worktreePath: string, branchName?: string) => void;
  regularSessionsCollapsed: boolean;
  onToggleRegularSessions: () => void;
  onReorderSessions: (projectId: string, orderedIds: string[]) => void;
  isMobile?: boolean;
  // Context menu
  contextMenuProject: string | null;
  contextMenuPos: { top: number; left: number } | null;
  onOpenContextMenu: (e: React.MouseEvent, type: 'project', id: string) => void;
  onCloseContextMenu: () => void;
  onSettingsProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  // New session
  isCreatingSession: boolean;
  newSessionName: string;
  onNewSessionNameChange: (name: string) => void;
  newSessionAgentProfileId: string;
  onNewSessionAgentProfileIdChange: (id: string) => void;
  onStartCreatingSession: () => void;
  onCreateSession: () => void;
  onCancelCreateSession: () => void;
  isConnected: boolean;
  agents: SidebarAgent[];
  // Pop-out (desktop only)
  onPopOutSession?: (sessionId: string, projectId: string) => void;
}

/** Props for NewProjectForm */
export interface NewProjectFormProps {
  showForm: boolean;
  onShowForm: (show: boolean) => void;
  newProjectName: string;
  onProjectNameChange: (name: string) => void;
  newProjectRootPath: string;
  onProjectRootPathChange: (path: string) => void;
  onCreateProject: () => void;
  creatingProject: boolean;
  isConnected: boolean;
  isMobile?: boolean;
  backends: { backendId: string; name: string; online: boolean }[];
  selectedBackendId: string | null;
  onSelectedBackendIdChange: (backendId: string) => void;
}

/** Props for SidebarFooter */
export interface SidebarFooterProps {
  onShowSettings: () => void;
  isMobile?: boolean;
}
