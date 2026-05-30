import type { ModeConfig } from '../../helpers/modes';

export const localMode: ModeConfig = {
  id: 'local',
  name: 'Local Server',
  enabled: true,
  serverAddress: 'localhost:3100',
  requiresAuth: false,
};
