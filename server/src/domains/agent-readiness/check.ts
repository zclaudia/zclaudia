// Compatibility re-export layer. The readiness engine lives in the
// agent-profiles domain (agent-profiles/readiness.ts) and the per-session
// resolution helpers live in the sessions domain (sessions/agent-readiness.ts).
// This module keeps the historical import paths working for consumers such as
// application composition and the projects routes, without reintroducing
// bidirectional domain dependencies.
export { configureRuntimeReadinessInspector } from '../agent-profiles/readiness.js';
export {
  resolveAgentReadinessForSessionWithRuntimeCheck,
  resolveAgentReadinessForSession,
} from '../sessions/agent-readiness.js';
