import { useEffect } from 'react';
import { useAgentConfigStore } from '../stores/agentConfigStore';

/** Load the assistant configuration and ensure its host project without desktop UI. */
export function useAgentInitialization(controlPlaneState: string): void {
  const enabled = useAgentConfigStore(s => s.config?.enabled);
  const hasLoaded = useAgentConfigStore(s => s.hasLoaded);
  const loadConfig = useAgentConfigStore(s => s.loadConfig);

  useEffect(() => {
    if (controlPlaneState !== 'ready') return;
    void loadConfig();
  }, [controlPlaneState, loadConfig]);

  useEffect(() => {
    if (controlPlaneState !== 'ready' || !hasLoaded || !enabled) return;
    void import('../services/api/servers')
      .then(({ ensureAgent }) => ensureAgent())
      .catch(error => {
        console.warn('[App] Failed to ensure Claudia host project:', error);
      });
  }, [controlPlaneState, enabled, hasLoaded]);
}
