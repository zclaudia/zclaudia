import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { RecordStatus } from '@zclaudia/shared/core/record-status';
import { fetchLocalApi, fetchApiForBackend } from './base';
export interface WorkspaceSkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  source?: 'workspace' | 'external' | 'plugin';
  eligible?: boolean;
  /** Computed on read by the server; present on the API response. */
  recordStatus?: RecordStatus;
  requirements?: {
    binaries?: string[];
    env?: string[];
    os?: string[];
  };
  metadata?: {
    whenToUse?: string;
    allowedTools?: string[];
    paths?: string[];
    arguments?: string[];
    argumentHint?: string;
    snippets?: string[];
    shellSnippets?: string[];
    hookTriggers?: {
      tools?: string[];
      paths?: string[];
    };
    userInvocable?: boolean;
  };
  execution?: {
    allowedModes?: string[];
    defaultMode?: string;
    forkToolPolicy?: string;
  };
  usage?: {
    count: number;
    lastUsedAt: number;
  };
}

export interface SkillLoadDiagnostic {
  type: 'warning' | 'error';
  code: string;
  message: string;
  path: string;
  source: 'workspace' | 'external' | 'plugin';
}

export interface WorkspaceSkillsResult {
  skills: WorkspaceSkillInfo[];
  diagnostics: SkillLoadDiagnostic[];
}

export async function getWorkspaceSkillsResult(): Promise<WorkspaceSkillsResult> {
  const result = (await fetchLocalApi<WorkspaceSkillInfo[]>(
    '/api/workspace/skills'
  )) as ApiResponse<WorkspaceSkillInfo[]> & {
    diagnostics?: SkillLoadDiagnostic[];
  };
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load workspace skills');
  return {
    skills: result.data,
    diagnostics: result.diagnostics ?? [],
  };
}

export async function getWorkspaceSkillsForBackend(
  backendId: string | null
): Promise<WorkspaceSkillInfo[]> {
  const result = await getWorkspaceSkillsResultForBackend(backendId);
  return result.skills;
}

export async function getWorkspaceSkillsResultForBackend(
  backendId: string | null
): Promise<WorkspaceSkillsResult> {
  const result = (await fetchApiForBackend<WorkspaceSkillInfo[]>(
    '/api/workspace/skills',
    backendId
  )) as ApiResponse<WorkspaceSkillInfo[]> & {
    diagnostics?: SkillLoadDiagnostic[];
  };
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load workspace skills');
  return {
    skills: result.data,
    diagnostics: result.diagnostics ?? [],
  };
}

export async function getWorkspaceSkillForBackend(
  backendId: string | null,
  skillId: string
): Promise<{ id: string; content: string }> {
  const result = await fetchApiForBackend<{ id: string; content: string }>(
    `/api/workspace/skills/${encodeURIComponent(skillId)}`,
    backendId
  );
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load workspace skill');
  return result.data;
}

export async function saveWorkspaceSkillForBackend(
  backendId: string | null,
  skillId: string,
  content: string
): Promise<void> {
  const result = await fetchApiForBackend<void>(
    `/api/workspace/skills/${encodeURIComponent(skillId)}`,
    backendId,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }
  );
  if (!result.success) throw new Error(result.error?.message || 'Failed to save workspace skill');
}

export async function deleteWorkspaceSkillForBackend(
  backendId: string | null,
  skillId: string
): Promise<void> {
  const result = await fetchApiForBackend<void>(
    `/api/workspace/skills/${encodeURIComponent(skillId)}`,
    backendId,
    {
      method: 'DELETE',
    }
  );
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete workspace skill');
}

export async function getExternalSkillDirsForBackend(backendId: string | null): Promise<string[]> {
  const result = await fetchApiForBackend<string[]>('/api/workspace/skill-dirs', backendId);
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load external skill directories');
  return result.data;
}

export async function saveExternalSkillDirsForBackend(
  backendId: string | null,
  dirs: string[]
): Promise<void> {
  const result = await fetchApiForBackend<void>('/api/workspace/skill-dirs', backendId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs }),
  });
  if (!result.success)
    throw new Error(result.error?.message || 'Failed to save external skill directories');
}

/** One importable skill found in an external agent's skills directory. */
export interface ExternalSkillCandidate {
  agent: string;
  agentLabel: string;
  /** Skill directory basename in the external source. */
  name: string;
  skillName?: string;
  description?: string;
  version?: string;
  sourceDir: string;
  skillMdPath: string;
  importable: boolean;
  skipReason?: string;
}

export interface ExternalSkillSourceScan {
  agent: string;
  agentLabel: string;
  path: string;
  status: 'ok' | 'missing';
  skills: ExternalSkillCandidate[];
}

export interface ExternalSkillScan {
  sources: ExternalSkillSourceScan[];
  importableCount: number;
}

export interface ExternalSkillImportOutcome {
  agent: string;
  agentLabel: string;
  name: string;
  status: 'imported' | 'skipped' | 'failed';
  reason?: string;
  targetPath?: string;
}

export interface ExternalSkillImportResult {
  mode: 'symlink' | 'copy';
  outcomes: ExternalSkillImportOutcome[];
  sources: Array<{
    agent: string;
    agentLabel: string;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
  }>;
  lockUpdated: boolean;
}

export async function scanExternalSkillsForBackend(
  backendId: string | null
): Promise<ExternalSkillScan> {
  const result = await fetchApiForBackend<ExternalSkillScan>(
    '/api/workspace/skills/import/scan',
    backendId
  );
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to scan external skills');
  return result.data;
}

export async function importExternalSkillsForBackend(
  backendId: string | null,
  selections: Array<{ agent: string; name: string }>,
  mode: 'symlink' | 'copy'
): Promise<ExternalSkillImportResult> {
  const result = await fetchApiForBackend<ExternalSkillImportResult>(
    '/api/workspace/skills/import',
    backendId,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, mode }),
    }
  );
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to import external skills');
  return result.data;
}
