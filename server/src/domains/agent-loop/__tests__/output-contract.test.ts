import { describe, expect, it } from 'vitest';
import {
  buildJsonContractPrompt,
  buildJsonRepairPrompt,
  createObjectJsonContract,
  parseJsonOutput,
} from '../output-contract.js';
import type { JsonOutputContract } from '../types.js';

const reviewContract: JsonOutputContract = {
  type: 'json',
  schema: {
    type: 'object',
    required: ['reviewPassed', 'reviewNotes'],
    properties: {
      reviewPassed: { type: 'boolean' },
      reviewNotes: { type: 'string' },
      confidence: { type: 'number' },
      decision: { enum: ['approve', 'deny', 'uncertain'] },
    },
  },
  repairAttempts: 1,
};

describe('parseJsonOutput', () => {
  it('parses fenced JSON and validates required fields', () => {
    const parsed = parseJsonOutput(
      '```json\n{"reviewPassed":true,"reviewNotes":"ok"}\n```',
      reviewContract
    );
    expect(parsed).toEqual({
      ok: true,
      output: { reviewPassed: true, reviewNotes: 'ok' },
    });
  });

  it('rejects invalid JSON with a repairable error', () => {
    const parsed = parseJsonOutput('review passed', reviewContract);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('valid JSON object');
    expect(buildJsonRepairPrompt('review passed', [parsed.error], reviewContract)).toContain(
      'Return valid JSON only'
    );
  });

  it('rejects missing required fields', () => {
    const parsed = parseJsonOutput('{"reviewPassed":true}', reviewContract);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('reviewNotes');
  });

  it('rejects enum values outside the contract', () => {
    const parsed = parseJsonOutput(
      '{"reviewPassed":true,"reviewNotes":"ok","decision":"maybe"}',
      reviewContract
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('decision');
  });
});

describe('buildJsonContractPrompt', () => {
  it('shows the requested schema on the first model attempt', () => {
    const prompt = buildJsonContractPrompt('Review the diff', reviewContract);

    expect(prompt).toContain('Review the diff');
    expect(prompt).toContain('Required JSON Output');
    expect(prompt).toContain('"reviewPassed"');
    expect(prompt).toContain('"reviewNotes"');
  });

  it('keeps the schema in repair prompts', () => {
    const prompt = buildJsonRepairPrompt(
      'review passed',
      ['$.reviewPassed is required'],
      reviewContract
    );

    expect(prompt).toContain('"reviewPassed"');
    expect(prompt).toContain('$.reviewPassed is required');
    expect(prompt).toContain('Previous output:');
  });
});

describe('createObjectJsonContract', () => {
  it('creates a JSON contract with a default repair attempt budget', () => {
    expect(createObjectJsonContract({ type: 'object' })).toEqual({
      type: 'json',
      schema: { type: 'object' },
      repairAttempts: 1,
    });
  });

  it('rejects non-object schema roots', () => {
    expect(() => createObjectJsonContract({ type: 'array' })).toThrow(/object schema root/i);
  });
});
