import { beforeEach, describe, expect, it } from 'vitest';
import { useAppearanceStore } from '../appearanceStore';

describe('appearanceStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppearanceStore.setState({ chatCard: false, unifiedWorkspace: false });
  });

  it('keeps both experiments opt-in', () => {
    expect(useAppearanceStore.getInitialState().chatCard).toBe(false);
    expect(useAppearanceStore.getInitialState().unifiedWorkspace).toBe(false);
  });

  it('persists only switches and restores them through hydration', async () => {
    useAppearanceStore.getState().setChatCard(true);
    useAppearanceStore.getState().setUnifiedWorkspace(true);
    const serialized = localStorage.getItem('claudia-appearance')!;
    expect(JSON.parse(serialized).state).toEqual({ chatCard: true, unifiedWorkspace: true });
    useAppearanceStore.setState({ chatCard: false, unifiedWorkspace: false });
    localStorage.setItem('claudia-appearance', serialized);
    await useAppearanceStore.persist.rehydrate();
    expect(useAppearanceStore.getState().chatCard).toBe(true);
    expect(useAppearanceStore.getState().unifiedWorkspace).toBe(true);
    useAppearanceStore.getState().setChatCard(false);
    expect(useAppearanceStore.getState().unifiedWorkspace).toBe(true);
  });

  it('loads earlier chat-card preferences and rejects malformed switches', async () => {
    localStorage.setItem('claudia-appearance', JSON.stringify({ state: { chatCard: true }, version: 0 }));
    await useAppearanceStore.persist.rehydrate();
    expect(useAppearanceStore.getState().chatCard).toBe(true);
    expect(useAppearanceStore.getState().unifiedWorkspace).toBe(false);
    localStorage.setItem('claudia-appearance', JSON.stringify({ state: { chatCard: 'true', unifiedWorkspace: {} }, version: 0 }));
    await useAppearanceStore.persist.rehydrate();
    expect(useAppearanceStore.getState().chatCard).toBe(false);
    expect(useAppearanceStore.getState().unifiedWorkspace).toBe(false);
    expect(typeof useAppearanceStore.getState().setChatCard).toBe('function');
  });
});
