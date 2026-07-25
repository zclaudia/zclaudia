import type { LlmModelDialect } from '@zclaudia/shared/core/llm-profile';

interface ToolSchemaModel {
  id?: string;
  provider: string;
  baseUrl: string;
  /**
   * Stamped by buildModel (typed there as `Model & { dialect?: LlmModelDialect }`)
   * from LlmProfileModelEntry.dialect / registry inherit. Declaring the same
   * type on the reader keeps the cross-module contract honest at both ends
   * instead of passing through `unknown` + a runtime string check.
   */
  dialect?: LlmModelDialect;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...record };
  for (const symbol of Object.getOwnPropertySymbols(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, symbol);
    if (descriptor) Object.defineProperty(clone, symbol, descriptor);
  }
  return clone;
}

/**
 * Moonshot's tool-schema validator rejects the otherwise-valid JSON Schema
 * shape `{ type: 'object', anyOf: [...] }`. Nested schemas must move the type
 * into each anyOf branch. Tool roots are stricter still: the OpenAI-compatible
 * envelope requires `type: 'object'`, making a root anyOf impossible. At the
 * root we therefore merge branch properties, keep only the `required` keys
 * every branch agrees on (intersection — a union would over-constrain the
 * anyOf), drop the combinator for model guidance, and leave exact validation
 * to the original execution-time schema: normalizeToolSchemasForModel returns
 * outbound-only copies and pi re-validates args against the ORIGINAL schema
 * before execute, so anything the merge cannot express degrades model
 * guidance, never correctness.
 */
export function normalizeMoonshotJsonSchema(schema: unknown, isRoot = true): unknown {
  if (Array.isArray(schema)) {
    let changed = false;
    const normalized = schema.map(value => {
      const next = normalizeMoonshotJsonSchema(value, false);
      if (next !== value) changed = true;
      return next;
    });
    return changed ? normalized : schema;
  }
  if (!isRecord(schema)) return schema;

  let normalized: Record<string, unknown> = schema;
  for (const [key, value] of Object.entries(schema)) {
    const next = normalizeMoonshotJsonSchema(value, false);
    if (next !== value) {
      if (normalized === schema) normalized = cloneRecord(schema);
      normalized[key] = next;
    }
  }

  if (isRoot && Array.isArray(normalized.anyOf)) {
    const branches = normalized.anyOf;
    const next = normalized === schema ? cloneRecord(schema) : normalized;
    const mergedProperties = isRecord(next.properties) ? cloneRecord(next.properties) : {};
    for (const branch of branches) {
      if (!isRecord(branch) || !isRecord(branch.properties)) continue;
      for (const [name, propertySchema] of Object.entries(branch.properties)) {
        if (!(name in mergedProperties)) mergedProperties[name] = propertySchema;
      }
    }
    // `required` merges as the INTERSECTION of branch requirements: a key is
    // required in the merged root only when EVERY branch requires it. A union
    // would be wrong for anyOf semantics (branch A requiring x and branch B
    // requiring y must not force both). Keys the merge cannot prove required
    // stay optional for the model and are still enforced at execution time
    // against the original schema (see the module-header note).
    const branchRequired = branches.map(branch =>
      isRecord(branch) && Array.isArray(branch.required)
        ? branch.required.filter((key): key is string => typeof key === 'string')
        : []
    );
    const intersection =
      branchRequired.length > 0
        ? branchRequired.reduce((acc, keys) => acc.filter(key => keys.includes(key)))
        : [];
    const existingRequired = Array.isArray(next.required)
      ? next.required.filter((key): key is string => typeof key === 'string')
      : [];
    const mergedRequired = [...new Set([...existingRequired, ...intersection])];
    next.type = 'object';
    if (Object.keys(mergedProperties).length > 0) next.properties = mergedProperties;
    if (mergedRequired.length > 0) next.required = mergedRequired;
    delete next.anyOf;
    return next;
  }

  if (normalized.type !== undefined && Array.isArray(normalized.anyOf)) {
    const parentType = normalized.type;
    const branches = normalized.anyOf.map(branch => {
      if (!isRecord(branch) || branch.type !== undefined) return branch;
      const nextBranch = cloneRecord(branch);
      nextBranch.type = parentType;
      return nextBranch;
    });
    const next = normalized === schema ? cloneRecord(schema) : normalized;
    delete next.type;
    next.anyOf = branches;
    return next;
  }

  return normalized;
}

export function usesMoonshotToolSchemaFlavor(model: ToolSchemaModel): boolean {
  // An explicit dialect is authoritative in both directions: 'moonshotai'
  // forces normalization on, anything else (incl. 'openai') forces it off —
  // heuristics below only apply when no dialect was resolved.
  if (model.dialect) {
    return model.dialect === 'moonshotai';
  }

  const provider = model.provider.toLowerCase();
  if (provider === 'moonshotai' || provider === 'moonshotai-cn' || provider === 'kimi-coding') {
    return true;
  }

  // OpenAI-compatible gateways commonly expose Moonshot models under a
  // private host and keep provider="openai". In that case the selected model
  // id is the only upstream-family signal available to this process.
  const modelId = model.id?.toLowerCase() ?? '';
  if (/(^|[/:._-])(?:kimi|moonshot(?:ai)?)(?=$|[/:._-])/.test(modelId)) return true;

  try {
    const host = new URL(model.baseUrl).hostname.toLowerCase();
    return host === 'api.moonshot.ai' || host === 'api.moonshot.cn' || host === 'api.kimi.com';
  } catch {
    return false;
  }
}

/** Return outbound-only tool copies so execution-time schemas remain untouched. */
export function normalizeToolSchemasForModel<T extends { parameters: unknown }>(
  tools: T[],
  model: ToolSchemaModel
): T[] {
  if (!usesMoonshotToolSchemaFlavor(model)) return tools;

  return tools.map(tool => {
    const parameters = normalizeMoonshotJsonSchema(tool.parameters);
    return parameters === tool.parameters ? tool : { ...tool, parameters };
  });
}

type AnyStreamFn = (model: any, context: any, options?: any) => any;

/**
 * Wrap a pi StreamFn so outbound tool schemas are normalized per-model at the
 * final boundary. Single chokepoint shared by the main session stream
 * (agent-stream.ts) and the lightweight agent loop (pi-agent-loop-executor.ts).
 */
export function wrapStreamFnWithToolSchemaCompat<T extends AnyStreamFn>(base: T): T {
  const wrapped = (model: any, context: any, options?: any) =>
    context?.tools
      ? base(
          model,
          { ...context, tools: normalizeToolSchemasForModel(context.tools, model) },
          options
        )
      : base(model, context, options);
  return wrapped as T;
}
