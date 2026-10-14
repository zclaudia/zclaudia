/**
 * Write/Edit/MultiEdit bridge tools for the pi runtime.
 *
 * This module is the public entry for the file-mutation bridge tools. The
 * implementation is split into focused modules under ./edit-write/:
 *   - shared.ts           result scaffolding, guard helpers, write-path
 *                         resolution, batch parsing, multi-file locking
 *   - mutation-details.ts diff budgets/truncation, mutation details and
 *                         model-visible result text
 *   - write-tool.ts       createWriteBridgeTool
 *   - edit-tool.ts        createEditBridgeTool (schema, parsing, dispatch)
 *   - patch-executor.ts   the apply_patch-style multi-file patch path
 *   - edit-core.ts        pure read-guard/match/apply logic for single files
 *   - persist-mutation.ts shared backup→write→record→lifecycle tail
 *   - multi-edit-tool.ts  createMultiEditBridgeTool
 *
 * Public surface is re-exported unchanged so external callers (tool-catalog,
 * symbol-tools, tests) keep importing from './edit-write-tools.js'.
 */

export { createWriteBridgeTool } from './edit-write/write-tool.js';
export { createEditBridgeTool } from './edit-write/edit-tool.js';
export { createMultiEditBridgeTool } from './edit-write/multi-edit-tool.js';
export type { FileMutationToolOptions } from './edit-write/shared.js';
