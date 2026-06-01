import type { Project, PermissionPolicy, ProjectType } from '@zclaudia/shared/core/project';

type ProjectStateFields = Pick<
  Project,
  'name' | 'type' | 'llmProfileId' | 'rootPath' | 'systemPrompt' |
  'reviewLlmProfileId' | 'permissionWorkflowOverrideId' | 'agent' | 'permissionPolicy' | 'agentPermissionOverride' |
  'sortOrder'
>;

type ProjectPatch = {
  [K in keyof ProjectStateFields]?: ProjectStateFields[K] | null;
};

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertJsonObject(value: unknown, field: string): void {
  if (value == null) return;
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object when provided`);
  }
}

function assertPermissionPolicy(policy: PermissionPolicy | null | undefined): void {
  if (policy == null) return;
  if (!Array.isArray(policy.allowedTools) || !Array.isArray(policy.disallowedTools)) {
    throw new Error('permissionPolicy must include allowedTools and disallowedTools arrays');
  }
}

function assertRequiredProjectFields(project: Pick<Project, 'name' | 'type'>): void {
  if (!project.name || !project.name.trim()) {
    throw new Error('Name is required');
  }

  if (!project.type) {
    throw new Error('Type is required');
  }
}

export function assertValidProjectState(
  project: Pick<Project, 'name' | 'type' | 'reviewLlmProfileId' | 'permissionWorkflowOverrideId' | 'agent' | 'permissionPolicy' | 'agentPermissionOverride'>,
): void {
  assertRequiredProjectFields(project);
  assertJsonObject(project.permissionPolicy, 'permissionPolicy');
  assertJsonObject(project.agentPermissionOverride, 'agentPermissionOverride');
  assertPermissionPolicy(project.permissionPolicy);

  if (project.reviewLlmProfileId && project.type !== 'code') {
    throw new Error('reviewLlmProfileId can only be set for code projects');
  }

  if (project.agent && project.type !== 'code') {
    throw new Error('Supervisor agent can only be configured for code projects');
  }
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function isProjectValidationError(error: unknown): error is Error {
  return error instanceof Error
    && (
      error.message.includes('must')
      || error.message.includes('only')
      || error.message.includes('include')
      || error.message.includes('required')
    );
}

export function buildProjectCreateState(
  body: Record<string, unknown>,
  sortOrder: number,
): Omit<Project, 'id' | 'createdAt' | 'updatedAt'> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw new Error('Name is required');
  }

  const type = (body.type as ProjectType | undefined) ?? 'code';
  const project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    type,
    llmProfileId: typeof body.llmProfileId === 'string' ? body.llmProfileId : undefined,
    rootPath: typeof body.rootPath === 'string' ? body.rootPath : undefined,
    systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
    permissionPolicy: (body.permissionPolicy as PermissionPolicy | undefined) ?? undefined,
    agentPermissionOverride: (body.agentPermissionOverride as Project['agentPermissionOverride'] | undefined) ?? undefined,
    reviewLlmProfileId: typeof body.reviewLlmProfileId === 'string' ? body.reviewLlmProfileId : undefined,
    permissionWorkflowOverrideId: typeof body.permissionWorkflowOverrideId === 'string' ? body.permissionWorkflowOverrideId : undefined,
    agent: (body.agent as Project['agent'] | undefined) ?? undefined,
    sortOrder,
  };

  assertValidProjectState(project);
  return project;
}

export function buildProjectPatch(body: Record<string, unknown>): ProjectPatch {
  const patch: ProjectPatch = {};

  if (hasOwn(body, 'name')) patch.name = body.name == null ? null : String(body.name).trim();
  if (hasOwn(body, 'type')) patch.type = body.type == null ? null : body.type as ProjectType;
  if (hasOwn(body, 'llmProfileId')) patch.llmProfileId = body.llmProfileId == null ? null : String(body.llmProfileId);
  if (hasOwn(body, 'rootPath')) patch.rootPath = body.rootPath == null ? null : String(body.rootPath);
  if (hasOwn(body, 'systemPrompt')) patch.systemPrompt = body.systemPrompt == null ? null : String(body.systemPrompt);
  if (hasOwn(body, 'permissionPolicy')) patch.permissionPolicy = (body.permissionPolicy ?? null) as PermissionPolicy | null;
  if (hasOwn(body, 'agentPermissionOverride')) patch.agentPermissionOverride = (body.agentPermissionOverride ?? null) as Project['agentPermissionOverride'] | null;
  if (hasOwn(body, 'reviewLlmProfileId')) patch.reviewLlmProfileId = body.reviewLlmProfileId == null ? null : String(body.reviewLlmProfileId);
  if (hasOwn(body, 'permissionWorkflowOverrideId')) patch.permissionWorkflowOverrideId = body.permissionWorkflowOverrideId == null ? null : String(body.permissionWorkflowOverrideId);
  if (hasOwn(body, 'agent')) patch.agent = (body.agent ?? null) as Project['agent'] | null;

  return patch;
}

export function applyProjectPatch(
  existing: Project,
  patch: ProjectPatch,
): ProjectStateFields {
  const nextState: ProjectStateFields = {
    name: patch.name === undefined ? existing.name : (patch.name ?? ''),
    type: patch.type === undefined ? existing.type : (patch.type ?? '' as ProjectType),
    llmProfileId: patch.llmProfileId === undefined ? existing.llmProfileId : patch.llmProfileId ?? undefined,
    rootPath: patch.rootPath === undefined ? existing.rootPath : patch.rootPath ?? undefined,
    systemPrompt: patch.systemPrompt === undefined ? existing.systemPrompt : patch.systemPrompt ?? undefined,
    permissionPolicy: patch.permissionPolicy === undefined ? existing.permissionPolicy : patch.permissionPolicy ?? undefined,
    agentPermissionOverride: patch.agentPermissionOverride === undefined ? existing.agentPermissionOverride : patch.agentPermissionOverride ?? undefined,
    reviewLlmProfileId: patch.reviewLlmProfileId === undefined ? existing.reviewLlmProfileId : patch.reviewLlmProfileId ?? undefined,
    permissionWorkflowOverrideId: patch.permissionWorkflowOverrideId === undefined ? existing.permissionWorkflowOverrideId : patch.permissionWorkflowOverrideId ?? undefined,
    agent: patch.agent === undefined ? existing.agent : patch.agent ?? undefined,
    sortOrder: existing.sortOrder,
  };

  assertRequiredProjectFields(nextState);
  return nextState;
}
