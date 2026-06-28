import { describe, it, expect, vi, beforeEach } from 'vitest';

const openPopoutWindow = vi.fn().mockResolvedValue('draft-window-1');
const getConnectionParams = vi.fn().mockReturnValue({ serverName: 'Local' });
const buildWindowTitle = vi.fn().mockReturnValue('Draft — Local');
const getSessionBackendId = vi.fn().mockReturnValue('backend-7');

vi.mock('../popoutWindow', () => ({
  openPopoutWindow: (...a: unknown[]) => openPopoutWindow(...a),
  getConnectionParams: (...a: unknown[]) => getConnectionParams(...a),
  buildWindowTitle: (...a: unknown[]) => buildWindowTitle(...a),
}));
vi.mock('../../stores/ownershipStore', () => ({
  useOwnershipStore: { getState: () => ({ getSessionBackendId }) },
}));

import { openDraftInNewWindow } from '../openDraftWindow';

describe('openDraftInNewWindow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the draft pop-out route with the session id and resolved backend', async () => {
    await openDraftInNewWindow('sess-123');

    expect(getSessionBackendId).toHaveBeenCalledWith('sess-123');
    expect(getConnectionParams).toHaveBeenCalledWith({ backendId: 'backend-7' });
    expect(openPopoutWindow).toHaveBeenCalledTimes(1);
    const opts = openPopoutWindow.mock.calls[0][0];
    expect(opts.type).toBe('draft');
    expect(opts.params).toEqual({ draftWindow: 'sess-123' });
    expect(opts.connectionTarget).toEqual({ backendId: 'backend-7' });
    expect(opts.title).toBe('Draft — Local');
  });
});
