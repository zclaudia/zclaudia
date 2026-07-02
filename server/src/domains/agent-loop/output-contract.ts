import type { JsonOutputContract } from './types.js';

export type ParsedJsonOutput =
  | { ok: true; output: Record<string, unknown> }
  | { ok: false; error: string };

export function createObjectJsonContract(
  schema: Record<string, unknown>,
  repairAttempts = 1
): JsonOutputContract {
  if (schema.type !== 'object') {
    throw new Error(
      "createObjectJsonContract expects an object schema root; schema.type must be 'object'"
    );
  }

  return {
    type: 'json',
    schema,
    repairAttempts,
  };
}

export function parseJsonOutput(text: string, contract: JsonOutputContract): ParsedJsonOutput {
  const extracted = extractJsonObject(text);
  if (!extracted) {
    return { ok: false, error: 'Model output did not contain a valid JSON object' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (error) {
    return {
      ok: false,
      error: `Model output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Model output JSON must be an object' };
  }

  const errors = validateSchemaSubset(parsed, contract.schema, '$');
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; ') };
  }

  return { ok: true, output: parsed };
}

export function buildJsonContractPrompt(input: string, contract: JsonOutputContract): string {
  return [input, buildJsonContractInstruction(contract)].filter(Boolean).join('\n\n');
}

export function buildJsonRepairPrompt(
  previousOutput: string,
  errors: string[],
  contract: JsonOutputContract
): string {
  return [
    buildJsonContractInstruction(contract),
    `The previous output failed validation: ${errors.join('; ')}`,
    'Previous output:',
    previousOutput,
  ].join('\n\n');
}

function buildJsonContractInstruction(contract: JsonOutputContract): string {
  return [
    '# Required JSON Output',
    'Return valid JSON only. Do not include Markdown fences or commentary.',
    'The JSON object must satisfy this schema:',
    JSON.stringify(contract.schema, null, 2),
  ].join('\n');
}

function extractJsonObject(text: string): string | undefined {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = fencedMatch[1].trim();
    if (fenced) {
      return fenced;
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return undefined;
}

function validateSchemaSubset(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const expectedType = schema.type;

  if (expectedType === 'object') {
    if (!isRecord(value)) {
      return [`${path} must be object`];
    }

    const required = Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : [];
    for (const field of required) {
      if (!Object.prototype.hasOwnProperty.call(value, field) || value[field] === undefined) {
        errors.push(`${path}.${field} is required`);
      }
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, field) || value[field] === undefined) {
        continue;
      }
      if (isRecord(fieldSchema)) {
        errors.push(...validateSchemaSubset(value[field], fieldSchema, `${path}.${field}`));
      }
    }
    return errors;
  }

  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be array`);
    }
  } else if (expectedType === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path} must be string`);
    }
  } else if (expectedType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path} must be number`);
    }
  } else if (expectedType === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${path} must be boolean`);
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(', ')}`);
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
