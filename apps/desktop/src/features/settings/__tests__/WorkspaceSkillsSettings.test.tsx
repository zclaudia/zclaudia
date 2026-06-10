import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceSkillsSettings } from '../WorkspaceSkillsSettings';

vi.mock('../../../services/api', () => ({
  getWorkspaceSkillsResult: vi.fn(),
  getExternalSkillDirs: vi.fn(),
  getWorkspaceSkill: vi.fn(),
  saveWorkspaceSkill: vi.fn(),
  deleteWorkspaceSkill: vi.fn(),
  saveExternalSkillDirs: vi.fn(),
}));

import * as api from '../../../services/api';

describe('WorkspaceSkillsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getExternalSkillDirs).mockResolvedValue([]);
    vi.mocked(api.getWorkspaceSkillsResult).mockResolvedValue({
      skills: [
        {
          id: 'reviewer',
          name: 'reviewer',
          description: 'Review code changes',
          path: '/skills/reviewer/SKILL.md',
          source: 'workspace',
          eligible: true,
          metadata: {
            whenToUse: 'Use for code review',
            allowedTools: ['Read'],
            paths: ['src/**'],
            snippets: ['Prefer small diffs'],
            shellSnippets: ['pnpm test'],
            hookTriggers: {
              tools: ['Bash'],
              paths: ['server/**'],
            },
          },
        },
        {
          id: 'windows-only',
          name: 'windows-only',
          description: 'Windows workflow',
          path: '/skills/windows-only/SKILL.md',
          source: 'external',
          eligible: false,
          requirements: { os: ['win32'] },
        },
      ],
      diagnostics: [
        {
          type: 'warning',
          code: 'INVALID_SKILL',
          message: 'Missing description',
          path: '/bad/SKILL.md',
          source: 'workspace',
        },
      ],
    });
  });

  it('renders diagnostics and filters skills by search query', async () => {
    render(<WorkspaceSkillsSettings readOnly />);

    await waitFor(() => expect(screen.getByText('Skill diagnostics')).toBeTruthy());
    expect(screen.getByText('INVALID_SKILL')).toBeTruthy();
    expect(screen.getByText('When: Use for code review')).toBeTruthy();
    expect(screen.getByText('snippet Prefer small diffs')).toBeTruthy();
    expect(screen.getByText('shell pnpm test')).toBeTruthy();
    expect(screen.getByText('hook tool Bash')).toBeTruthy();
    expect(screen.getByText('hook path server/**')).toBeTruthy();
    expect(screen.getByText('requires os: win32')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search skills...'), {
      target: { value: 'pnpm test' },
    });

    expect(screen.getByText('reviewer')).toBeTruthy();
    expect(screen.queryByText('windows-only')).toBeNull();
  });
});
