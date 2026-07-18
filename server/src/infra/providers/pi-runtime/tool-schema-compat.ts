interface ToolSchemaModel {
  id?: string;
  provider: string;
  baseUrl: string;
  compat?: unknown;
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
 * root we therefore merge branch properties, drop the combinator for model
 * guidance, and leave exact validation to the original execution-time schema.
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
    next.type = 'object';
    if (Object.keys(mergedProperties).length > 0) next.properties = mergedProperties;
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
  if (isRecord(model.compat) && model.compat.toolSchemaFlavor === 'moonshot') return true;

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
