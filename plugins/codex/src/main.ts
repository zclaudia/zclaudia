import type { PluginContext } from '@zclaudia/shared/plugins';
import { CodexAgentAdapter } from './adapter.js';

export async function activate(context: PluginContext): Promise<void> {
  if (!context.agentRuntimes) {
    context.log.error('provider.register permission missing; cannot register codex runtime');
    return;
  }
  const adapter = new CodexAgentAdapter(req => context.agentRuntimes!.createToolBridge(req));
  context.agentRuntimes.register(adapter);
}

export async function deactivate(): Promise<void> {
  // Loader unregisters contributions.
}
