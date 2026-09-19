import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';

export interface NewSessionRequest {
  projectId: string | null;
  pickerEnabled: boolean;
}

/**
 * State bundle for the "new session" modal: the pending request (target
 * project + whether the picker flow is enabled), the optional name and agent
 * profile, and the resolved target project.
 */
export function useNewSessionModal() {
  const [newSessionRequest, setNewSessionRequest] = useState<NewSessionRequest | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionAgentProfileId, setNewSessionAgentProfileId] = useState('');
  const allProjects = useProjectStore(s => s.projects);
  const newSessionProject = newSessionRequest?.projectId
    ? (allProjects.find(p => p.id === newSessionRequest.projectId) ?? null)
    : null;

  return {
    request: newSessionRequest,
    setRequest: setNewSessionRequest,
    name: newSessionName,
    setName: setNewSessionName,
    agentProfileId: newSessionAgentProfileId,
    setAgentProfileId: setNewSessionAgentProfileId,
    allProjects,
    project: newSessionProject,
  };
}

export type NewSessionModalState = ReturnType<typeof useNewSessionModal>;
