import { describe, expect, expectTypeOf, it } from 'vitest';
import { PHASE_TYPES } from './index.js';
import type {
  AgentReadiness,
  ExecutorInstance,
  MetaWorkflowRun,
  ProviderPolicy,
  SpecChange,
  TaskRecord,
} from './index.js';

type ExpectedRootExports = [
  AgentReadiness,
  ProviderPolicy,
  TaskRecord,
  ExecutorInstance,
  SpecChange,
  MetaWorkflowRun,
];

function assertRootExports<T extends ExpectedRootExports>(): void {
  void (0 as unknown as T);
}

describe('shared root exports', () => {
  it('keeps legacy root coverage for shared kernel and feature types', () => {
    assertRootExports<ExpectedRootExports>();
    expectTypeOf<AgentReadiness>().toMatchTypeOf<{ usable: boolean }>();
    expectTypeOf<ProviderPolicy>().toMatchTypeOf<{ nativeInteractionTools?: string[] }>();
    expectTypeOf<TaskRecord>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<ExecutorInstance>().toHaveProperty('projectId').toEqualTypeOf<string>();
    expectTypeOf<SpecChange>().toHaveProperty('slug').toEqualTypeOf<string>();
    expectTypeOf<MetaWorkflowRun>().toHaveProperty('projectId').toEqualTypeOf<string>();
    expect(PHASE_TYPES).toContain('investigation');
    expect(true).toBe(true);
  });
});
