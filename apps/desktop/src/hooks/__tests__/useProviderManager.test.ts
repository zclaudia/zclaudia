// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProviderManager } from '../useProviderManager.js';

// Mock the api module
vi.mock('../../services/api', () => ({
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
}));

describe('hooks/useProviderManager', () => {
  let mockCreateProvider: ReturnType<typeof vi.fn>;
  let mockUpdateProvider: ReturnType<typeof vi.fn>;
  let mockDeleteProvider: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    const api = vi.importMock('../../services/api') as {
      createLlmProfile: ReturnType<typeof vi.fn>;
      updateLlmProfile: ReturnType<typeof vi.fn>;
      deleteLlmProfile: ReturnType<typeof vi.fn>;
    };

    mockCreateProvider = api.createLlmProfile;
    mockUpdateProvider = api.updateLlmProfile;
    mockDeleteProvider = api.deleteLlmProfile;
  });

  describe('return value', () => {
    it('returns all manager functions', () => {
      const { result } = renderHook(() => useProviderManager());

      expect(result.current).toHaveProperty('addProvider');
      expect(result.current).toHaveProperty('updateProvider');
      expect(result.current).toHaveProperty('deleteProvider');

      expect(typeof result.current.addProvider).toBe('function');
      expect(typeof result.current.updateProvider).toBe('function');
      expect(typeof result.current.deleteProvider).toBe('function');
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useProviderManager());

      const firstAddProvider = result.current.addProvider;
      const firstUpdateProvider = result.current.updateProvider;
      const firstDeleteProvider = result.current.deleteProvider;

      rerender();

      expect(result.current.addProvider).toBe(firstAddProvider);
      expect(result.current.updateProvider).toBe(firstUpdateProvider);
      expect(result.current.deleteProvider).toBe(firstDeleteProvider);
    });
  });

  describe('addProvider', () => {
    it('calls createProvider API with provider data', async () => {
      const { createLlmProfile } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      const providerData = {
        name: 'claude',
        type: 'claude' as const,
        apiKey: 'test-key',
      };

      await result.current.addProvider(providerData);

      expect(createLlmProfile).toHaveBeenCalledWith(providerData);
      expect(createLlmProfile).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from createProvider', async () => {
      const { createLlmProfile } = await import('../../services/api.js');
      const error = new Error('API error');
      vi.mocked(createLlmProfile).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(result.current.addProvider({ name: 'test', type: 'claude' })).rejects.toThrow(
        'API error'
      );
    });
  });

  describe('updateProvider', () => {
    it('calls updateProvider API with id and updates', async () => {
      const { updateLlmProfile } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      const updates = { apiKey: 'new-key' };

      await result.current.updateProvider('provider-1', updates);

      expect(updateLlmProfile).toHaveBeenCalledWith('provider-1', updates);
      expect(updateLlmProfile).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from updateProvider', async () => {
      const { updateLlmProfile } = await import('../../services/api.js');
      const error = new Error('Update failed');
      vi.mocked(updateLlmProfile).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(
        result.current.updateProvider('provider-1', { name: 'new-name' })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('deleteProvider', () => {
    it('calls deleteProvider API with id', async () => {
      const { deleteLlmProfile } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      await result.current.deleteProvider('provider-1');

      expect(deleteLlmProfile).toHaveBeenCalledWith('provider-1');
      expect(deleteLlmProfile).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from deleteProvider', async () => {
      const { deleteLlmProfile } = await import('../../services/api.js');
      const error = new Error('Delete failed');
      vi.mocked(deleteLlmProfile).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(result.current.deleteProvider('provider-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('integration scenarios', () => {
    it('can perform CRUD operations in sequence', async () => {
      const { createLlmProfile, updateLlmProfile, deleteLlmProfile } =
        await import('../../services/api.js');

      const { result } = renderHook(() => useProviderManager());

      // Create
      await result.current.addProvider({ name: 'test', type: 'claude' });
      expect(createLlmProfile).toHaveBeenCalled();

      // Update
      await result.current.updateProvider('test-id', { name: 'updated' });
      expect(updateLlmProfile).toHaveBeenCalled();

      // Delete
      await result.current.deleteProvider('test-id');
      expect(deleteLlmProfile).toHaveBeenCalled();
    });
  });
});
