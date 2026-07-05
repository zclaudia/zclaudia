import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchApiForBackend, apiCallVoidForBackend, backendSupports } = vi.hoisted(() => ({
  fetchApiForBackend: vi.fn(),
  apiCallVoidForBackend: vi.fn(),
  backendSupports: vi.fn(),
}));

vi.mock('../base', async importOriginal => {
  const actual = await importOriginal<typeof import('../base')>();
  return { ...actual, fetchApiForBackend, backendSupports };
});

vi.mock('../unwrap', async importOriginal => {
  const actual = await importOriginal<typeof import('../unwrap')>();
  return { ...actual, apiCallVoidForBackend };
});

import { deleteLlmProfileForBackend, setDefaultLlmProfileForBackend } from '../llm-profiles';

describe('deleteLlmProfileForBackend', () => {
  beforeEach(() => {
    fetchApiForBackend.mockReset();
  });

  it('returns ok:true on success', async () => {
    fetchApiForBackend.mockResolvedValue({ success: true });
    const result = await deleteLlmProfileForBackend('backend-1', 'profile-1');
    expect(fetchApiForBackend).toHaveBeenCalledWith('/api/llm-profiles/profile-1', 'backend-1', {
      method: 'DELETE',
    });
    expect(result).toEqual({ ok: true });
  });

  it('preserves code/message/agentCount from a 409 IN_USE response', async () => {
    fetchApiForBackend.mockResolvedValue({
      success: false,
      error: { code: 'IN_USE', message: 'Profile is in use', agentCount: 3 },
    });
    const result = await deleteLlmProfileForBackend('backend-1', 'profile-1');
    expect(result).toEqual({
      ok: false,
      code: 'IN_USE',
      message: 'Profile is in use',
      agentCount: 3,
    });
  });

  it('returns NETWORK_ERROR when the request throws', async () => {
    fetchApiForBackend.mockRejectedValue(new Error('boom'));
    const result = await deleteLlmProfileForBackend('backend-1', 'profile-1');
    expect(result).toEqual({ ok: false, code: 'NETWORK_ERROR', message: 'boom' });
  });
});

describe('setDefaultLlmProfileForBackend', () => {
  beforeEach(() => {
    backendSupports.mockReset();
    apiCallVoidForBackend.mockReset();
  });

  it('skips the request when the backend does not support setDefaultProvider', async () => {
    backendSupports.mockReturnValue(false);
    await setDefaultLlmProfileForBackend('backend-1', 'profile-1');
    expect(backendSupports).toHaveBeenCalledWith('backend-1', 'setDefaultProvider');
    expect(apiCallVoidForBackend).not.toHaveBeenCalled();
  });

  it('calls through when the backend supports setDefaultProvider', async () => {
    backendSupports.mockReturnValue(true);
    apiCallVoidForBackend.mockResolvedValue(undefined);
    await setDefaultLlmProfileForBackend('backend-1', 'profile-1');
    expect(apiCallVoidForBackend).toHaveBeenCalledWith(
      'backend-1',
      '/api/llm-profiles/profile-1/set-default',
      { method: 'POST' }
    );
  });
});
