export const sessionWorkspaceId = (sessionId: string): string => JSON.stringify(['session-workspace', sessionId]);

/** Chosen during store creation, before persist hydration or any window edits. */
export function workspaceStorageKey(baseName: string, search: string): string {
  const params = new URLSearchParams(search);
  const sessionId = params.get('sessionWindow');
  if (sessionId) return `${baseName}:session:${encodeURIComponent(sessionId)}`;
  const projectId = params.get('projectDashboard');
  return projectId ? `${baseName}:dashboard:${encodeURIComponent(projectId)}` : baseName;
}

/** Preserve corrupt bytes and let Zustand finish hydration with an empty snapshot. */
export function recoverableJsonStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: key => {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        try {
          const backup = `${key}:corrupt`;
          const previous = storage.getItem(backup);
          if (previous !== raw) {
            let target = previous === null ? backup : `${backup}:${Date.now()}`;
            let suffix = 0;
            while (storage.getItem(target) !== null) target = `${backup}:${Date.now()}:${++suffix}`;
            storage.setItem(target, raw);
          }
          storage.removeItem(key);
        } catch { /* If backup storage fails, keep the original bytes in place. */ }
        return null;
      }
    },
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: key => storage.removeItem(key),
  };
}
