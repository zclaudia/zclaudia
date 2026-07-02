import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOL_METADATA,
  resolveToolSelection,
  type ToolName,
} from '@zclaudia/shared/core/tools';

import { BUILTIN_TOOL_FACTORIES } from '../tool-catalog.js';
import { buildPiRunPrompt } from '../run-prompt.js';
import { loopRecoveryForFailure } from '../remediation.js';
import {
  EDIT_TOOL_SELECTION_EVAL_FIXTURES,
  type EditToolSelectionEvalAssertion,
} from './fixtures/edit-tool-selection-evals.js';

const effectivePrompt = buildPiRunPrompt({
  systemPrompt: 'You are a coding agent.',
  externalProviderCatalog: '',
  skillCatalog: '',
  activeSkillContext: '',
  isPlanMode: false,
}).effectiveSystemPrompt;

const coreCodingTools = resolveToolSelection({
  sets: [{ source: 'builtin', id: 'core-coding' }],
  include: [],
  exclude: [],
}).builtinTools;

function toolSchema(tool: ToolName): {
  required?: unknown;
  properties?: Record<string, unknown>;
} {
  const factory = BUILTIN_TOOL_FACTORIES[tool];
  const created = factory('/tmp/zclaudia-edit-tool-selection-eval') as unknown as {
    parameters?: { required?: unknown; properties?: Record<string, unknown> };
  };
  return created.parameters ?? {};
}

function expectTerms(text: string, terms: string[]): void {
  for (const term of terms) {
    expect(text, `missing term: ${term}`).toContain(term);
  }
}

function runAssertion(assertion: EditToolSelectionEvalAssertion): void {
  switch (assertion.kind) {
    case 'prompt':
      expectTerms(effectivePrompt, assertion.terms);
      break;
    case 'core-tools':
      for (const tool of assertion.tools) {
        expect(coreCodingTools).toContain(tool);
      }
      break;
    case 'schema': {
      const schema = toolSchema(assertion.tool);
      for (const property of assertion.properties) {
        expect(schema.properties, `${assertion.tool} schema properties`).toHaveProperty(property);
      }
      if (assertion.required) {
        expect(schema.required).toEqual(expect.arrayContaining(assertion.required));
      }
      break;
    }
    case 'metadata': {
      const metadata = BUILTIN_TOOL_METADATA[assertion.tool];
      expect(metadata.declaredReadOnly).toBe(assertion.declaredReadOnly);
      expect(metadata.mutatesWorkspace).toBe(assertion.mutatesWorkspace);
      break;
    }
    case 'loop-recovery': {
      const recovery = loopRecoveryForFailure(
        assertion.tool,
        assertion.args,
        assertion.details,
        assertion.attempts
      );
      if (assertion.nextTool) {
        expect(recovery?.nextTool).toBe(assertion.nextTool);
      } else {
        expect(recovery).toBeDefined();
      }
      expectTerms([recovery?.summary, ...(recovery?.steps ?? [])].join(' '), assertion.terms);
      break;
    }
  }
}

describe('edit tool selection offline eval fixtures', () => {
  it('has stable fixture ids', () => {
    const ids = EDIT_TOOL_SELECTION_EVAL_FIXTURES.map(fixture => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(EDIT_TOOL_SELECTION_EVAL_FIXTURES)('$id', fixture => {
    expect(fixture.task.trim().length).toBeGreaterThan(20);
    expect(fixture.expectedPrimaryTools.length).toBeGreaterThan(0);

    for (const tool of fixture.expectedPrimaryTools) {
      expect(coreCodingTools).toContain(tool);
      expect(BUILTIN_TOOL_FACTORIES[tool]).toBeDefined();
      expect(BUILTIN_TOOL_METADATA[tool]).toBeDefined();
    }

    for (const assertion of fixture.assertions) {
      runAssertion(assertion);
    }
  });
});
