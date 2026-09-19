import { useEffect, useState } from 'react';
import type { BackendSnapshot } from '@zclaudia/shared';

/**
 * State bundle for the "new project" modal: visibility, name, root path,
 * target backend, and the in-flight creation flag. Consumers read/write
 * through the returned fields (name/setName, backendId/setBackendId, …).
 */
export function useNewProjectForm(onlineBackends: BackendSnapshot[]) {
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRootPath, setNewProjectRootPath] = useState('');
  const [newProjectBackendId, setNewProjectBackendId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // Default the new-project backend to the first online backend when the form opens.
  useEffect(() => {
    if (showNewProjectForm && !newProjectBackendId && onlineBackends.length > 0) {
      setNewProjectBackendId(onlineBackends[0].backendId);
    }
  }, [showNewProjectForm, newProjectBackendId, onlineBackends]);

  return {
    show: showNewProjectForm,
    setShow: setShowNewProjectForm,
    name: newProjectName,
    setName: setNewProjectName,
    rootPath: newProjectRootPath,
    setRootPath: setNewProjectRootPath,
    backendId: newProjectBackendId,
    setBackendId: setNewProjectBackendId,
    creating: creatingProject,
    setCreating: setCreatingProject,
  };
}

export type NewProjectFormState = ReturnType<typeof useNewProjectForm>;
