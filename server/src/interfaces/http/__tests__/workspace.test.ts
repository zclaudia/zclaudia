import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkspaceRoutes } from '../workspace.js';
import { workspaceService } from '../../../application/services/workspace.js';
import {
  getDiscoveredSkills,
  getExternalSkillDirs,
  getSkillLoadDiagnostics,
  refreshSkillCache,
  saveExternalSkillDirs,
} from '../../../application/plugins/skill-tools.js';
import {
  importExternalSkills,
  recordImportedExternalSkills,
  scanExternalSkillSources,
} from '../../../application/plugins/skill-import.js';

vi.mock('../../../application/services/workspace.js', () => ({
  workspaceService: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    listSkills: vi.fn(),
    loadSkill: vi.fn(),
    getWorkspaceDir: vi.fn(() => '/tmp/zclaudia-workspace'),
    clearCache: vi.fn(),
    assembleSystemPrompt: vi.fn(),
    initialize: vi.fn(),
  },
}));

vi.mock('../../../application/plugins/skill-tools.js', () => ({
  refreshSkillCache: vi.fn(),
  getDiscoveredSkills: vi.fn(),
  getSkillLoadDiagnostics: vi.fn(),
  getExternalSkillDirs: vi.fn(),
  saveExternalSkillDirs: vi.fn(),
}));

vi.mock('../../../application/plugins/skill-import.js', () => ({
  scanExternalSkillSources: vi.fn(),
  importExternalSkills: vi.fn(),
  recordImportedExternalSkills: vi.fn(),
}));

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspace', createWorkspaceRoutes());
  return app;
}

describe('workspace routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceService.getConfig).mockResolvedValue({
      soul: null,
      agents: null,
      tools: null,
    });
    vi.mocked(workspaceService.loadSkill).mockResolvedValue('# Skill');
    vi.mocked(getDiscoveredSkills).mockReturnValue([]);
    vi.mocked(getSkillLoadDiagnostics).mockReturnValue([]);
    vi.mocked(getExternalSkillDirs).mockReturnValue([]);
    vi.mocked(refreshSkillCache).mockResolvedValue(0);
    vi.mocked(recordImportedExternalSkills).mockReturnValue({ updated: false });
  });

  it('returns structured 400 when config update body is empty', async () => {
    const res = await request(app).put('/api/workspace/config').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'No configuration fields provided',
      },
    });
  });

  it('returns structured 404 when skill does not exist', async () => {
    vi.mocked(workspaceService.loadSkill).mockResolvedValueOnce(null);

    const res = await request(app).get('/api/workspace/skills/missing-skill');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Skill not found: missing-skill',
      },
    });
  });

  it('lists skills with metadata, requirements, eligibility, and diagnostics', async () => {
    vi.mocked(getDiscoveredSkills).mockReturnValue([
      {
        id: 'rich',
        name: 'rich',
        description: 'rich skill',
        source: 'workspace',
        filePath: '/workspace/skills/rich/SKILL.md',
        dirPath: '/workspace/skills/rich',
        eligible: false,
        requirements: { os: ['win32'] },
        metadata: {
          whenToUse: 'Use for rich work',
          allowedTools: ['Read'],
          paths: ['src/**'],
          userInvocable: false,
        },
        usage: { count: 2, lastUsedAt: 3000 },
      },
    ] as any);
    vi.mocked(getSkillLoadDiagnostics).mockReturnValue([
      {
        type: 'warning',
        code: 'INVALID_SKILL',
        message: 'Bad skill',
        path: '/bad/SKILL.md',
        source: 'workspace',
      },
    ]);

    const res = await request(app).get('/api/workspace/skills');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: 'rich',
        eligible: false,
        requirements: { os: ['win32'] },
        metadata: {
          whenToUse: 'Use for rich work',
          allowedTools: ['Read'],
          paths: ['src/**'],
          userInvocable: false,
        },
        usage: { count: 2, lastUsedAt: 3000 },
      }),
    ]);
    expect(res.body.diagnostics).toEqual([
      expect.objectContaining({ code: 'INVALID_SKILL', message: 'Bad skill' }),
    ]);
  });

  it('returns structured 400 for invalid skill id on save', async () => {
    const res = await request(app)
      .post('/api/workspace/skills/bad..skill')
      .send({ content: '# bad' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid skill ID',
      },
    });
  });

  it('returns structured 400 when skill dirs payload is invalid', async () => {
    const res = await request(app).put('/api/workspace/skill-dirs').send({ dirs: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'dirs must be an array of strings',
      },
    });
    expect(saveExternalSkillDirs).not.toHaveBeenCalled();
  });

  it('returns structured 500 when get config fails', async () => {
    vi.mocked(workspaceService.getConfig).mockRejectedValueOnce(new Error('boom'));

    const res = await request(app).get('/api/workspace/config');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'boom',
      },
    });
  });

  describe('external skills import', () => {
    it('scans external sources and returns per-source candidates', async () => {
      vi.mocked(scanExternalSkillSources).mockReturnValueOnce({
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
                importable: true,
                sourceDir: '/home/.claude/skills/review',
                skillMdPath: '/home/.claude/skills/review/SKILL.md',
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
        ],
        importableCount: 1,
      } as any);

      const res = await request(app).get('/api/workspace/skills/import/scan');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.importableCount).toBe(1);
      expect(res.body.data.sources).toHaveLength(2);
      expect(scanExternalSkillSources).toHaveBeenCalledTimes(1);
    });

    it('returns structured 400 when import selections are invalid', async () => {
      for (const body of [undefined, {}, { selections: 'nope' }, { selections: [{ agent: 1 }] }]) {
        const res = await request(app)
          .post('/api/workspace/skills/import')
          .send(body as object);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(importExternalSkills).not.toHaveBeenCalled();
    });

    it('returns structured 400 for an invalid import mode', async () => {
      const res = await request(app)
        .post('/api/workspace/skills/import')
        .send({ selections: [{ agent: 'claude-code', name: 'x' }], mode: 'hardlink' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('mode must be "symlink" or "copy"');
      expect(importExternalSkills).not.toHaveBeenCalled();
    });

    it('imports, refreshes the skill cache, records the lock, and returns counts', async () => {
      const importResult = {
        mode: 'symlink',
        targetSkillDir: '/home/.zclaudia/skills',
        outcomes: [
          {
            agent: 'claude-code',
            agentLabel: 'Claude Code',
            name: 'review',
            status: 'imported',
            targetPath: '/home/.zclaudia/skills/review',
          },
          {
            agent: 'codex',
            agentLabel: 'Codex CLI',
            name: 'dupe',
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
          {
            agent: 'codex',
            agentLabel: 'Codex CLI',
            importedCount: 0,
            skippedCount: 1,
            failedCount: 0,
          },
        ],
        imported: [
          {
            agent: 'claude-code',
            agentLabel: 'Claude Code',
            name: 'review',
            sourceDir: '/home/.claude/skills/review',
            targetPath: '/home/.zclaudia/skills/review',
          },
        ],
      };
      vi.mocked(importExternalSkills).mockReturnValueOnce(importResult as any);
      vi.mocked(recordImportedExternalSkills).mockReturnValueOnce({ updated: true });

      const res = await request(app)
        .post('/api/workspace/skills/import')
        .send({
          selections: [{ agent: 'claude-code', name: 'review' }],
          mode: 'symlink',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ ...importResult, lockUpdated: true });
      expect(importExternalSkills).toHaveBeenCalledWith({
        selections: [{ agent: 'claude-code', name: 'review' }],
        mode: 'symlink',
      });
      expect(workspaceService.clearCache).toHaveBeenCalled();
      expect(refreshSkillCache).toHaveBeenCalled();
      expect(recordImportedExternalSkills).toHaveBeenCalledWith({
        imports: importResult.imported,
      });
    });

    it('defaults the import mode to symlink', async () => {
      vi.mocked(importExternalSkills).mockReturnValueOnce({
        mode: 'symlink',
        outcomes: [],
        sources: [],
        imported: [],
      } as any);

      const res = await request(app)
        .post('/api/workspace/skills/import')
        .send({ selections: [{ agent: 'cursor', name: 'x' }] });

      expect(res.status).toBe(200);
      expect(importExternalSkills).toHaveBeenCalledWith({
        selections: [{ agent: 'cursor', name: 'x' }],
        mode: 'symlink',
      });
    });
  });
});
