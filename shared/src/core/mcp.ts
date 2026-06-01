// MCP Server Types

import type { LlmProviderType } from './llm-profile.js';

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
  providerScope?: LlmProviderType[];
  source: 'user' | 'imported';
  createdAt: number;
  updatedAt: number;
}
