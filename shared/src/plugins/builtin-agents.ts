/** Host-reserved identities. A manifest cannot opt itself into built-in trust. */
export const BUILTIN_AGENT_PLUGINS = [
  { id: 'com.zclaudia.claude', runtime: 'claude', directory: 'claude', name: 'Claude Agent' },
  { id: 'com.zclaudia.codex', runtime: 'codex', directory: 'codex', name: 'Codex Agent' },
  { id: 'com.zclaudia.cursor', runtime: 'cursor', directory: 'cursor', name: 'Cursor Agent' },
] as const;

export function isBuiltinAgentPluginId(id: string): boolean {
  return BUILTIN_AGENT_PLUGINS.some(plugin => plugin.id === id);
}

export function builtinAgentPluginForRuntime(runtime: string) {
  return BUILTIN_AGENT_PLUGINS.find(plugin => plugin.runtime === runtime);
}
