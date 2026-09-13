import Ajv2020 from 'ajv/dist/2020.js';
import type {
  InvocationArguments,
  InvocationErrorCode,
  InvocationRequest,
  InvocableCatalogSnapshot,
  InvocableDescriptor,
  MaterializedPortableSkill,
  PortableSkillAssessment,
  RuntimeAttachment,
  RuntimeInvocableRecord,
  RuntimeTurnInput,
} from '@zclaudia/shared/providers';
import { InvocationError } from '@zclaudia/shared/providers';
import {
  contextFingerprint,
  sameContextIdentity,
  type CatalogContextBinding,
  type InvocableCatalogService,
} from './catalog-service.js';
import { hostActionRegistry } from './host-actions.js';

const schemaValidator = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
});

export interface InvocationResolution {
  transcriptText: string;
  metadata: {
    invocableId: string;
    kind: string;
    runtimeType: string | 'host';
    executionMode: string;
    fidelity: string;
    argumentType: 'raw' | 'structured';
    catalogRevision: string;
    contextFingerprint: string;
  };
  turnInput?: RuntimeTurnInput;
  hostAction?:
    | { name: string; locus: 'client'; clientActionId: string }
    | { name: string; locus: 'server' };
}

export interface ResolveDependencies {
  currentBinding: CatalogContextBinding;
  currentSnapshot: InvocableCatalogSnapshot;
  snapshotByRevision: (
    revision: string,
    fingerprint?: string
  ) => InvocableCatalogSnapshot | undefined;
  bindingByRevision?: (revision: string, fingerprint?: string) => CatalogContextBinding | undefined;
  recordFor: (
    id: string,
    revision: string,
    fingerprint?: string
  ) => RuntimeInvocableRecord | undefined;
  materializePortableSkill?: (
    descriptor: InvocableDescriptor,
    arguments_: InvocationArguments,
    record: RuntimeInvocableRecord
  ) => Promise<MaterializedPortableSkill>;
  assessPortableSkill?: (
    descriptor: InvocableDescriptor,
    record: RuntimeInvocableRecord
  ) => Promise<PortableSkillAssessment | undefined> | PortableSkillAssessment | undefined;
  attachments?: RuntimeAttachment[];
}

function fail(code: InvocationErrorCode, message: string): never {
  throw new InvocationError(code, message);
}

function sameDescriptor(left: InvocableDescriptor, right: InvocableDescriptor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function resolveInvocation(
  request: InvocationRequest,
  deps: ResolveDependencies
): Promise<InvocationResolution> {
  const recomputedFingerprint = contextFingerprint(deps.currentBinding);
  if (
    recomputedFingerprint !== deps.currentSnapshot.contextFingerprint ||
    request.contextFingerprint !== deps.currentSnapshot.contextFingerprint
  ) {
    fail(
      'INVOCATION_CONTEXT_CHANGED',
      'The session context changed after selection; refresh the catalog.'
    );
  }

  const referencedSnapshot = deps.snapshotByRevision(
    request.catalogRevision,
    request.contextFingerprint
  );
  if (!referencedSnapshot) {
    fail('INVOCATION_CATALOG_STALE', 'The referenced catalog is no longer available.');
  }
  const referencedBinding = deps.bindingByRevision?.(
    request.catalogRevision,
    request.contextFingerprint
  );
  if (referencedBinding && !sameContextIdentity(referencedBinding, deps.currentBinding)) {
    fail(
      'INVOCATION_CONTEXT_CHANGED',
      'The session context changed after selection; refresh the catalog.'
    );
  }

  const selectedDescriptor = referencedSnapshot.invocables.find(
    item => item.id === request.invocableId
  );
  if (!selectedDescriptor) fail('INVOCATION_NOT_FOUND', 'The selected invocable no longer exists.');

  const descriptor = deps.currentSnapshot.invocables.find(item => item.id === request.invocableId);
  if (!descriptor) fail('INVOCATION_NOT_FOUND', 'The selected invocable no longer exists.');
  if (!sameDescriptor(selectedDescriptor, descriptor)) {
    fail('INVOCATION_CATALOG_STALE', 'The selected invocable changed; select it again.');
  }
  if (!descriptor.availability.available) {
    fail('INVOCATION_UNAVAILABLE', descriptor.availability.reason);
  }

  validateArguments(descriptor, request.arguments);

  if (descriptor.kind === 'host.action') {
    const definition = hostActionRegistry.get(descriptor.name);
    if (!definition) fail('INVOCATION_NOT_FOUND', 'The selected host action no longer exists.');
    const transcriptText = deriveTranscriptText(descriptor, request.arguments);
    if (definition.executionLocus === 'client') {
      if (!definition.clientActionId) {
        fail('INVOCATION_PREPARE_FAILED', 'The client host action is not registered correctly.');
      }
      return {
        transcriptText,
        metadata: buildMetadata(descriptor, request),
        hostAction: {
          name: descriptor.name,
          locus: 'client',
          clientActionId: definition.clientActionId,
        },
      };
    }
    return {
      transcriptText,
      metadata: buildMetadata(descriptor, request),
      hostAction: { name: descriptor.name, locus: 'server' },
    };
  }

  const currentRecord = deps.recordFor(
    request.invocableId,
    deps.currentSnapshot.revision,
    deps.currentSnapshot.contextFingerprint
  );
  const selectedRecord = deps.recordFor(
    request.invocableId,
    request.catalogRevision,
    request.contextFingerprint
  );
  if (!currentRecord || !selectedRecord) {
    fail('INVOCATION_CATALOG_STALE', 'The catalog was refreshed; select the item again.');
  }
  if (
    request.catalogRevision !== deps.currentSnapshot.revision &&
    (selectedRecord.contentDigest === undefined || currentRecord.contentDigest === undefined)
  ) {
    fail(
      'INVOCATION_CATALOG_STALE',
      'The catalog changed and this invocable has no content digest; select it again.'
    );
  }
  if (
    selectedRecord.contentDigest !== undefined &&
    selectedRecord.contentDigest !== currentRecord.contentDigest
  ) {
    fail(
      descriptor.kind === 'portable.skill' ? 'PORTABLE_SKILL_CHANGED' : 'INVOCATION_CATALOG_STALE',
      'The selected invocable changed; select it again.'
    );
  }

  const transcriptText = deriveTranscriptText(descriptor, request.arguments);
  if (descriptor.kind === 'portable.skill') {
    const assessment = await deps.assessPortableSkill?.(descriptor, currentRecord);
    if (!assessment || !assessment.supported) {
      fail(
        'PORTABLE_SKILL_UNSUPPORTED',
        assessment && !assessment.supported
          ? assessment.reason
          : 'This runtime cannot execute the skill.'
      );
    }
    if (!deps.materializePortableSkill) {
      fail('INVOCATION_PREPARE_FAILED', 'Portable skill materialization is unavailable.');
    }
    const materialized = await deps.materializePortableSkill(
      descriptor,
      request.arguments,
      currentRecord
    );
    return {
      transcriptText,
      metadata: buildMetadata(descriptor, request),
      turnInput: {
        type: 'portable-skill',
        skill: materialized,
        assessment,
        arguments: request.arguments,
        ...(deps.attachments?.length ? { attachments: deps.attachments } : {}),
      },
    };
  }

  return {
    transcriptText,
    metadata: buildMetadata(descriptor, request),
    turnInput: {
      type: 'runtime-invocation',
      descriptor,
      nativeLocator: currentRecord.nativeLocator,
      arguments: request.arguments,
      ...(deps.attachments?.length ? { attachments: deps.attachments } : {}),
    },
  };
}

function validateArguments(descriptor: InvocableDescriptor, args: InvocationArguments): void {
  const contract = descriptor.execution.arguments;
  if (!contract.accepted.includes(args.type)) {
    fail('INVOCATION_ARGUMENTS_INVALID', `This item does not accept ${args.type} arguments.`);
  }
  if (args.type === 'raw') {
    if (typeof args.value !== 'string') {
      fail('INVOCATION_ARGUMENTS_INVALID', 'Raw arguments must be a string.');
    }
    return;
  }
  if (!args.value || typeof args.value !== 'object' || Array.isArray(args.value)) {
    fail('INVOCATION_ARGUMENTS_INVALID', 'Structured arguments must be an object.');
  }
  if (!contract.schema || typeof contract.schema !== 'object') {
    fail('INVOCATION_ARGUMENTS_INVALID', 'Structured arguments require a valid schema.');
  }
  try {
    const validate = schemaValidator.compile(contract.schema);
    if (!validate(args.value)) {
      const detail = schemaValidator.errorsText(validate.errors, { separator: '; ' });
      fail('INVOCATION_ARGUMENTS_INVALID', `Structured arguments are invalid: ${detail}`);
    }
  } catch (error) {
    if (error instanceof InvocationError) throw error;
    fail(
      'INVOCATION_ARGUMENTS_INVALID',
      `Descriptor schema is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function deriveTranscriptText(
  descriptor: InvocableDescriptor,
  args: InvocationArguments
): string {
  const trigger = descriptor.displayTrigger;
  if (args.type === 'raw') {
    const policy = descriptor.execution.arguments.transcript.raw ?? 'verbatim';
    if (policy === 'omit-arguments') return trigger;
    return args.value.length > 0 ? `${trigger} ${args.value}` : trigger;
  }
  const policy = descriptor.execution.arguments.transcript.structured ?? 'schema-redacted';
  if (policy === 'omit-arguments') return trigger;
  const schema = descriptor.execution.arguments.schema as Record<string, unknown> | undefined;
  const redacted = redactStructuredValue(args.value, schema, schema) as Record<string, unknown>;
  const rendered = Object.keys(redacted)
    .sort()
    .map(key => `--${key}=${JSON.stringify(redacted[key])}`);
  return rendered.length > 0 ? `${trigger} ${rendered.join(' ')}` : trigger;
}

function redactStructuredValue(value: unknown, schema: unknown, rootSchema: unknown): unknown {
  const schemas = expandSchemas(schema, rootSchema);
  if (schemas.length === 0) return value;
  if (schemas.some(item => item.writeOnly === true)) return undefined;
  if (Array.isArray(value)) {
    const itemSchemas = schemas.flatMap(item => (item.items === undefined ? [] : [item.items]));
    return value.map(item => redactStructuredValue(item, itemSchemas, rootSchema));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const propertySchemas = schemas.flatMap(item => {
      const properties = item.properties;
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
      const propertySchema = (properties as Record<string, unknown>)[key];
      return propertySchema === undefined ? [] : [propertySchema];
    });
    const redacted = redactStructuredValue(
      (value as Record<string, unknown>)[key],
      propertySchemas,
      rootSchema
    );
    if (redacted !== undefined) result[key] = redacted;
  }
  return result;
}

function expandSchemas(
  schema: unknown,
  rootSchema: unknown,
  seen = new Set<object>()
): Array<Record<string, unknown>> {
  const inputs = Array.isArray(schema) ? schema : [schema];
  const result: Array<Record<string, unknown>> = [];
  for (const value of inputs) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    const item = value as Record<string, unknown>;
    result.push(item);
    if (typeof item.$ref === 'string') {
      result.push(...expandSchemas(resolveLocalSchemaRef(rootSchema, item.$ref), rootSchema, seen));
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else'] as const) {
      result.push(...expandSchemas(item[keyword], rootSchema, seen));
    }
  }
  return result;
}

function resolveLocalSchemaRef(rootSchema: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = rootSchema;
  for (const encoded of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function buildMetadata(
  descriptor: InvocableDescriptor,
  request: InvocationRequest
): InvocationResolution['metadata'] {
  return {
    invocableId: descriptor.id,
    kind: descriptor.kind,
    runtimeType: descriptor.runtimeType,
    executionMode: descriptor.execution.mode,
    fidelity: descriptor.execution.fidelity,
    argumentType: request.arguments.type,
    catalogRevision: request.catalogRevision,
    contextFingerprint: request.contextFingerprint,
  };
}

export { sameContextIdentity };
export type { InvocableCatalogService };
