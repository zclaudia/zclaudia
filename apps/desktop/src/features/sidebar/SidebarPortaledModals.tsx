import { createPortal } from 'react-dom';
import type { Project } from '@zclaudia/shared/core/project';
import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import { ProjectSettings } from '../settings';
import { PluginPermissionDialog } from '../../components/permission/PluginPermissionDialog';
import { AgentRequiredDialog } from '../agent';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { NewSessionModal } from './NewSessionModal';
import { NewProjectModal } from './NewProjectModal';
import type { SidebarAgent } from './types';
import type { NewProjectFormState } from './useNewProjectForm';
import type { NewSessionModalState } from './useNewSessionModal';

interface SidebarPortaledModalsProps {
  settingsProjectId: string | null;
  settingsProject: Project | null;
  onClearSettingsProject: () => void;
  agentDialogOpen: boolean;
  agentDialogReason: AgentReadinessReason | undefined;
  onCloseAgentDialog: () => void;
  newSession: NewSessionModalState;
  /** Agent choices for the new-session dropdown (read-only agents excluded). */
  agents: SidebarAgent[];
  runAfterAgentGate: (
    action: () => void | Promise<void>,
    options?: { forceRefresh?: boolean }
  ) => void;
  onCreateSession: (projectId: string) => void;
  newProject: NewProjectFormState;
  onCreateProject: (agentProfileId?: string) => void;
  backends: { backendId: string; name: string; online: boolean }[];
  isConnected: boolean;
  isMobile?: boolean;
}

/**
 * The Sidebar's modal/portal layer: project settings, the agent-required
 * guidance dialog, plugin permission requests, and the new-session /
 * new-project modals. Rendered by every Sidebar variant (mobile drawer,
 * collapsed desktop, expanded desktop).
 */
export function SidebarPortaledModals({
  settingsProjectId,
  settingsProject,
  onClearSettingsProject,
  agentDialogOpen,
  agentDialogReason,
  onCloseAgentDialog,
  newSession,
  agents,
  runAfterAgentGate,
  onCreateSession,
  newProject,
  onCreateProject,
  backends,
  isConnected,
  isMobile,
}: SidebarPortaledModalsProps) {
  const newSessionProject = newSession.project;

  return (
    <>
      {!!settingsProjectId &&
        createPortal(
          <ProjectSettings
            project={settingsProject}
            isOpen={!!settingsProjectId}
            onClose={onClearSettingsProject}
          />,
          document.body
        )}
      {agentDialogOpen &&
        createPortal(
          <AgentRequiredDialog
            open={agentDialogOpen}
            reason={agentDialogReason}
            onClose={onCloseAgentDialog}
            onConfigure={destination => {
              onCloseAgentDialog();
              // Every readiness destination lives in the Agents shell mode now
              // (providers deep-link included) — no settings fallback.
              useTopLevelViewStore.getState().openAgents(destination.tab);
            }}
          />,
          document.body
        )}
      {createPortal(<PluginPermissionDialog />, document.body)}
      {newSession.request && (
        <NewSessionModal
          open
          onClose={() => {
            newSession.setRequest(null);
            newSession.setName('');
            newSession.setAgentProfileId('');
          }}
          project={newSessionProject}
          projects={newSession.allProjects.filter(p => !p.isInternal)}
          showProjectPicker={newSession.request.pickerEnabled}
          onProjectChange={projectId => {
            newSession.setRequest(r => (r ? { ...r, projectId } : r));
          }}
          agents={agents}
          name={newSession.name}
          onNameChange={newSession.setName}
          agentProfileId={newSession.agentProfileId}
          onAgentProfileIdChange={newSession.setAgentProfileId}
          onCreate={() => {
            if (!newSessionProject) return;
            runAfterAgentGate(() => onCreateSession(newSessionProject.id), { forceRefresh: true });
          }}
          isConnected={isConnected}
          isMobile={isMobile}
        />
      )}
      {newProject.show && (
        <NewProjectModal
          open
          onClose={() => {
            newProject.setShow(false);
            newProject.setName('');
            newProject.setRootPath('');
            newProject.setBackendId(null);
          }}
          name={newProject.name}
          onNameChange={newProject.setName}
          rootPath={newProject.rootPath}
          onRootPathChange={newProject.setRootPath}
          onCreate={agentProfileId => onCreateProject(agentProfileId)}
          creatingProject={newProject.creating}
          isConnected={isConnected}
          isMobile={isMobile}
          backends={backends}
          selectedBackendId={newProject.backendId}
          onSelectedBackendIdChange={newProject.setBackendId}
        />
      )}
    </>
  );
}
