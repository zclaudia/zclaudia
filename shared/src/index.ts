// Shared types for ZClaudia
// This file re-exports all types from sub-modules for backward compatibility.
// Consumers should prefer sub-path imports (e.g. '@zclaudia/shared/core/session').
//
// ── Direction ────────────────────────────────────────────────────────
//
//   shared-kernel:          Core domain types used across all contexts
//     core/*, features/*, interaction/*, files, plugin-types
//
//   app-wire-protocol:      App-specific client↔server message unions & correlation
//     wire/correlation, wire/messages
//
//   ui-facade:              Frontend-only facade runtime & types
//     facade/*
//
// Neutral relay/wire contracts (gateway sync, notification wire, agent run,
// zclaudia resource shapes) live in the published `@zclaudia/protocol` package
// and are imported directly from there — `shared` does NOT re-export them, so
// each concept has exactly one import source.
//
// No physical split required yet — sub-path imports already enforce boundaries.
// ──────────────────────────────────────────────────────────────────────

// ── shared-kernel ────────────────────────────────────────────────────

// Core types
export * from './core/server.js';
export * from './core/llm-profile.js';
export * from './core/agent-profile.js';
export * from './core/agent-readiness.js';
export * from './core/tools.js';
export * from './core/skills.js';
export * from './core/runtime-capabilities.js';
export * from './core/session.js';
export * from './core/message.js';
export * from './core/attachment-validation.js';
export * from './core/context-graph.js';
export * from './core/project.js';
export * from './core/api.js';
export * from './core/mcp.js';
export * from './core/pcp.js';
export * from './core/provider-policy.js';
export type {
  BuiltinTaskType,
  TaskType,
  TaskEventType,
  TaskExecutorRef,
  TaskArtifact,
  TaskRecord,
  TaskEvent,
} from './core/task.js';

// Feature types
export * from './features/commands.js';
export * from './features/supervision.js';
export * from './features/local-pr.js';
export * from './features/local-issue.js';
export * from './features/epic.js';
export type {
  ExecutorType,
  ExecutorStatus,
  ExecutorInstance,
  ExecutorInstanceCreate,
  ExecutorInstanceUpdate,
  ExecutorInput,
  ExecutorProgress,
  IExecutor,
} from './features/executor.js';
export * from './features/attachment.js';
export * from './features/turn-summary.js';
export * from './features/system-tasks.js';
export * from './features/workflows.js';
export * from './features/automations.js';
export * from './features/notification-feed.js';
export * from './features/goal.js';
export * from './features/spec-change.js';
export * from './features/meta-workflow.js';

// Interaction types
export * from './interaction/permissions.js';
export * from './interaction/forms.js';
export * from './interaction/tool-rule-syntax.js';
export * from './interaction/user-hooks.js';

// File browser types
export * from './files.js';

// Plugin types
export * from './plugin-types.js';

// ── app-wire-protocol ────────────────────────────────────────────────

export * from './wire/correlation.js';
export * from './wire/messages.js';

// ── ui-facade ────────────────────────────────────────────────────────

export * from './facade/index.js';
