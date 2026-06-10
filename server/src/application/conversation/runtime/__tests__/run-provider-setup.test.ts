import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StoredFile } from '../../../../infra/storage/fileStore.js';

// Mock the fileStore module so getFileStore() returns a controllable stub.
const mockGetFile = vi.fn<[string], StoredFile | null>();

vi.mock('../../../../infra/storage/fileStore.js', () => ({
  getFileStore: () => ({ getFile: mockGetFile }),
}));

// Minimal stubs for createPermissionCallback deps
vi.mock('../run-permissions.js', () => ({
  createPermissionCallback: vi.fn(() => vi.fn()),
}));

// ---------- helpers ----------

function makeInput(messageInput: string) {
  return {
    activeRun: {
      sessionId: 'session-1',
      pendingPermissions: new Map(),
      db: {} as any,
    } as any,
    client: { ws: {} as any } as any,
    broadcastToOtherAuthenticatedClients: vi.fn(),
    connectedClients: new Map(),
    cwd: '/tmp/proj',
    db: {} as any,
    message: {
      type: 'run_start' as const,
      clientRequestId: 'req-1',
      sessionId: 'session-1',
      input: messageInput,
    },
    notificationService: {} as any,
    providerConfig: undefined,
    llmProfileId: null,
    providerType: 'zclaudia',
    runId: 'run-1',
    sendMessage: vi.fn(),
    sendRunEvent: vi.fn(),
    session: {
      id: 'session-1',
      project_id: 'project-1',
      name: null,
      sdk_session_id: null,
      session_type: 'regular' as const,
      working_directory: null,
      project_role: null,
      plan_status: null,
      task_id: null,
      agent_profile_id: 'agent-1',
      root_path: null,
    },
    sessionType: 'regular' as const,
    markPendingResolutionResumed: vi.fn(),
    permissionBridge: {} as any,
    permissionWorkflowResolver: {} as any,
  };
}

describe('run-provider-setup', () => {
  beforeEach(() => {
    mockGetFile.mockReset();
  });

  it('parses the envelope, resolves images, and appends notices for failures', async () => {
    const { prepareProviderRun } = await import('../run-provider-setup.js');

    const goodAtt = { fileId: 'file-good', name: 'a.png', mimeType: 'image/png', type: 'image' as const };
    const missingAtt = { fileId: 'file-missing', name: 'b.png', mimeType: 'image/png', type: 'image' as const };

    mockGetFile.mockImplementation((id) => {
      if (id === 'file-good') {
        return { id: 'file-good', name: 'a.png', mimeType: 'image/png', size: 10, data: 'QQ==', createdAt: 0 };
      }
      return null;
    });

    const envelopeInput = JSON.stringify({ text: 'check this', attachments: [goodAtt, missingAtt] });
    const prepared = prepareProviderRun(makeInput(envelopeInput));

    expect(prepared.processedInput).toContain('check this');
    expect(prepared.processedInput).toContain('file unavailable');
    expect(prepared.images).toEqual([{ name: 'a.png', mimeType: 'image/png', data: 'QQ==' }]);
  });

  it('plain text input flows through unchanged with no images', async () => {
    const { prepareProviderRun } = await import('../run-provider-setup.js');

    mockGetFile.mockReturnValue(null);

    const prepared = prepareProviderRun(makeInput('just text'));

    expect(prepared.processedInput).toBe('just text');
    expect(prepared.images).toEqual([]);
  });

  it('envelope with no attachments returns empty images and clean processedInput', async () => {
    const { prepareProviderRun } = await import('../run-provider-setup.js');

    const envelopeInput = JSON.stringify({ text: 'no attachments here', attachments: [] });
    const prepared = prepareProviderRun(makeInput(envelopeInput));

    expect(prepared.processedInput).toBe('no attachments here');
    expect(prepared.images).toEqual([]);
  });
});
