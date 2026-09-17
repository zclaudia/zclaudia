// Wire contract for the /api/agent/config endpoints, shared by the server
// (interfaces/http/agent.ts) and the desktop client (services/api/servers.ts).
// Keep this in sync with the route's serialization; drift here previously
// produced diverging copies on each side.
export interface AgentConfig {
  id: number;
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  llmProfileId: string | null;
  permissionWorkflowOverrideId: string | null;
  permissionPolicy: string | null;
  hooks: string | null;
  createdAt: number;
  updatedAt: number;
}
