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
