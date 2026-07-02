import type { ApiResponse } from '@zclaudia/shared';
import { fetchLocalApi } from './base';
export interface WorkspaceSkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  source?: 'workspace' | 'external' | 'plugin';
  eligible?: boolean;
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

export async function getWorkspaceSkills(): Promise<WorkspaceSkillInfo[]> {
  const result = await getWorkspaceSkillsResult();
  return result.skills;
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

export async function getWorkspaceSkill(skillId: string): Promise<{ id: string; content: string }> {
  const result = await fetchLocalApi<{ id: string; content: string }>(
    `/api/workspace/skills/${encodeURIComponent(skillId)}`
  );
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load workspace skill');
  return result.data;
}

export async function saveWorkspaceSkill(skillId: string, content: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!result.success) throw new Error(result.error?.message || 'Failed to save workspace skill');
}

export async function deleteWorkspaceSkill(skillId: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete workspace skill');
}

export async function getExternalSkillDirs(): Promise<string[]> {
  const result = await fetchLocalApi<string[]>('/api/workspace/skill-dirs');
  if (!result.success || !result.data)
    throw new Error(result.error?.message || 'Failed to load external skill directories');
  return result.data;
}

export async function saveExternalSkillDirs(dirs: string[]): Promise<void> {
  const result = await fetchLocalApi<void>('/api/workspace/skill-dirs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs }),
  });
  if (!result.success)
    throw new Error(result.error?.message || 'Failed to save external skill directories');
}
