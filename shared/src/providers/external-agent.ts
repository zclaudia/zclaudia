// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
export type {
  ExternalAgentAdapter,
  ExternalAgentAdapterCompat,
  ExternalAgentRunContext,
  InvocationExecutionMode,
  ExternalAgentRunState,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
  EngineExecutionContext,
  RuntimeModelConnection,
} from '@zclaudia/plugin-sdk/providers';
export { adapterIsRunnable } from '@zclaudia/plugin-sdk/providers';

// URIP contracts (canonical definitions live in @zclaudia/plugin-sdk).
export type {
  StandardInvocableKind,
  InvocableKind,
  InvocableScope,
  InvocableOwner,
  InvocationArgumentKind,
  InvocationArgumentContract,
  InvocableDescriptor,
  RuntimeInvocableRecord,
  InvocableDiagnostic,
  RuntimeInvocableCatalog,
  CatalogPhase,
  RuntimeCatalogDelta,
  InvocableCatalogSnapshot,
  InvocationArguments,
  InvocationRequest,
  RuntimeAttachment,
  PortableSkillResourceEntry,
  PortableSkillResourceAccess,
  MaterializedPortableSkill,
  RuntimeTurnInput,
  RuntimeDiscoveryContext,
  RuntimeInvocationCapabilities,
  PortableSkillCandidate,
  PortableSkillAssessment,
  PortableSkillResourceReader,
  RuntimeTurnContext,
  RuntimeInvocationProvider,
  ExternalAgentAdapterV2,
  InvocationErrorCode,
} from '@zclaudia/plugin-sdk/invocations';
export { InvocationError } from '@zclaudia/plugin-sdk/invocations';
export {
  INVOCATION_ERROR_CODES,
  validateInvocationRegistration,
  validatePortableSkillAssessment,
  validateInvocationArgumentContract,
} from '@zclaudia/plugin-sdk/invocations';
