// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
export type {
  AgentRuntimeContribution,
  AgentRuntimeDescriptor,
  EngineModeConnection,
  EngineModeDescriptor,
  EngineModeExecutable,
  RuntimeModelProtocol,
} from '@zclaudia/plugin-sdk/providers';
export {
  RUNTIME_ERROR_CODES,
  RuntimeContractError,
  validateEngineModeDeclarations,
} from '@zclaudia/plugin-sdk/providers';
export type { RuntimeErrorCode } from '@zclaudia/plugin-sdk/providers';

import type { AgentRuntimeDescriptor } from '@zclaudia/plugin-sdk/providers';

/**
 * How a runtime honors a project's additional directories:
 * - 'native': the engine itself is given the directories (Claude, Codex).
 * - 'host':   ZClaudia enforces them in its own tools / permission bridge (Pi,
 *             Cursor file edits; Cursor shell commands still ask).
 * - 'none':   not supported; writes there keep going through approval.
 */
export type AdditionalDirectoriesSupport = 'native' | 'host' | 'none';

export const ADDITIONAL_DIRECTORIES_SUPPORT: readonly AdditionalDirectoriesSupport[] = [
  'native',
  'host',
  'none',
];

/**
 * Host view of a runtime descriptor. The pinned plugin-sdk contract does not
 * declare `additionalDirectories` yet; plugins state it in plugin.json and the
 * host reads it here. Absent means 'none'.
 */
export type HostAgentRuntimeDescriptor = AgentRuntimeDescriptor & {
  additionalDirectories?: AdditionalDirectoriesSupport;
};

export function additionalDirectoriesSupportOf(
  descriptor: object | undefined
): AdditionalDirectoriesSupport {
  const value = (descriptor as { additionalDirectories?: unknown } | undefined)
    ?.additionalDirectories;
  return value === 'native' || value === 'host' ? value : 'none';
}
