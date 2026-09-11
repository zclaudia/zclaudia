import type { PluginContext } from '@zclaudia/plugin-sdk/runtime';
import { registerAgentRuntime } from '@zclaudia/agent-common';
import { ClaudeAgentAdapter } from './adapter.js';
let adapter: ClaudeAgentAdapter | undefined;

export async function activate(context: PluginContext): Promise<void> {
  adapter = registerAgentRuntime(context, 'claude', bridge => new ClaudeAgentAdapter(bridge));
}

export async function deactivate(): Promise<void> {
  adapter?.dispose();
  adapter = undefined;
}
