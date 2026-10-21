// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillImportModal } from '../SkillImportModal';
import * as api from '../../../services/api';
import type { ExternalSkillImportResult, ExternalSkillScan } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  scanExternalSkillsForBackend: vi.fn(),
  importExternalSkillsForBackend: vi.fn(),
}));

const scan: ExternalSkillScan = {
  sources: [
    {
      agent: 'claude-code',
      agentLabel: 'Claude Code',
      path: '/home/.claude/skills',
      status: 'ok',
      skills: [
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          name: 'review',
          skillName: 'review-skill',
          version: '1.2.0',
          description: 'Reviews code',
          sourceDir: '/home/.claude/skills/review',
          skillMdPath: '/home/.claude/skills/review/SKILL.md',
          importable: true,
        },
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          name: 'dupe',
          sourceDir: '/home/.claude/skills/dupe',
          skillMdPath: '/home/.claude/skills/dupe/SKILL.md',
          importable: false,
          skipReason: 'target_exists',
        },
      ],
    },
    {
      agent: 'codex',
      agentLabel: 'Codex CLI',
      path: '/home/.codex/skills',
      status: 'missing',
      skills: [],
    },
    {
      agent: 'cursor',
      agentLabel: 'Cursor',
      path: '/home/.cursor/skills',
      status: 'ok',
      skills: [
        {
          agent: 'cursor',
          agentLabel: 'Cursor',
          name: 'docs-writer',
          description: 'Writes docs',
          sourceDir: '/home/.cursor/skills/docs-writer',
          skillMdPath: '/home/.cursor/skills/docs-writer/SKILL.md',
          importable: true,
        },
      ],
    },
  ],
  importableCount: 2,
};

const importResult: ExternalSkillImportResult = {
  mode: 'symlink',
  outcomes: [
    {
      agent: 'claude-code',
      agentLabel: 'Claude Code',
      name: 'review',
      status: 'imported',
      targetPath: '/home/.zclaudia/skills/review',
    },
    {
      agent: 'cursor',
      agentLabel: 'Cursor',
      name: 'docs-writer',
      status: 'skipped',
      reason: 'target_exists',
    },
  ],
  sources: [
    {
      agent: 'claude-code',
      agentLabel: 'Claude Code',
      importedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    },
    { agent: 'cursor', agentLabel: 'Cursor', importedCount: 0, skippedCount: 1, failedCount: 0 },
  ],
  lockUpdated: true,
};

function setup() {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(<SkillImportModal open backendId="b1" onClose={onClose} onImported={onImported} />);
  return { onClose, onImported };
}

describe('SkillImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.scanExternalSkillsForBackend).mockResolvedValue(scan);
    vi.mocked(api.importExternalSkillsForBackend).mockResolvedValue(importResult);
  });

  it('scans on open and lists only importable skills per source', async () => {
    setup();

    expect(await screen.findByText('review-skill')).toBeInTheDocument();
    expect(screen.getByText('v1.2.0')).toBeInTheDocument();
    expect(screen.getByText('docs-writer')).toBeInTheDocument();

    // Collision-filtered candidates are not offered for import.
    expect(screen.queryByText('dupe')).toBeNull();
    // Missing sources stay visible (with their scan path) but offer nothing.
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('not found')).toBeInTheDocument();
    expect(api.scanExternalSkillsForBackend).toHaveBeenCalledWith('b1');
  });

  it('imports selected skills with the default symlink mode and shows results', async () => {
    const { onImported } = setup();

    fireEvent.click(await screen.findByLabelText('Import review'));
    fireEvent.click(screen.getByRole('button', { name: 'Import (1)' }));

    await waitFor(() =>
      expect(api.importExternalSkillsForBackend).toHaveBeenCalledWith(
        'b1',
        [{ agent: 'claude-code', name: 'review' }],
        'symlink'
      )
    );

    // Result view lists every outcome with its status; skipped gets its reason.
    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
    expect(screen.getByText('already imported')).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('switches the import mode to copy via the footer select', async () => {
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Import mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Copy (standalone duplicate)' }));

    fireEvent.click(screen.getByLabelText('Import docs-writer'));
    fireEvent.click(screen.getByRole('button', { name: 'Import (1)' }));

    await waitFor(() =>
      expect(api.importExternalSkillsForBackend).toHaveBeenCalledWith(
        'b1',
        [{ agent: 'cursor', name: 'docs-writer' }],
        'copy'
      )
    );
  });

  it('selects all importable skills at once', async () => {
    setup();

    fireEvent.click(await screen.findByLabelText('Select all skills'));
    fireEvent.click(screen.getByRole('button', { name: 'Import (2)' }));

    await waitFor(() =>
      expect(api.importExternalSkillsForBackend).toHaveBeenCalledWith(
        'b1',
        [
          { agent: 'claude-code', name: 'review' },
          { agent: 'cursor', name: 'docs-writer' },
        ],
        'symlink'
      )
    );
  });

  it('shows the empty state and disables Import when nothing is importable', async () => {
    vi.mocked(api.scanExternalSkillsForBackend).mockResolvedValue({
      sources: [
        {
          agent: 'claude-code',
          agentLabel: 'Claude Code',
          path: '/home/.claude/skills',
          status: 'missing',
          skills: [],
        },
      ],
      importableCount: 0,
    });
    setup();

    expect(await screen.findByText('No importable skills found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('surfaces scan failures as an inline error', async () => {
    vi.mocked(api.scanExternalSkillsForBackend).mockRejectedValue(new Error('scan boom'));
    setup();

    expect(await screen.findByText('scan boom')).toBeInTheDocument();
  });
});
