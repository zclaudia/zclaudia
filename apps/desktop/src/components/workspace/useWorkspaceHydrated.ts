import { useLayoutPresetStore } from '../../stores/layoutPresetStore';
import { useSyncExternalStore } from 'react';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';

const stores = [useAppearanceStore, useRightWorkspaceStore, useRightSidebarStore, useProjectWorkspaceStore, useLayoutPresetStore];
const isHydrated = () => stores.every(store => !store.persist || store.persist.hasHydrated());
const subscribe = (notify: () => void) => {
  const cleanups = stores.flatMap(store => store.persist ? [store.persist.onHydrate(notify), store.persist.onFinishHydration(notify)] : []);
  return () => cleanups.forEach(cleanup => cleanup());
};

export function useWorkspaceHydrated() {
  return useSyncExternalStore(subscribe, isHydrated, () => false);
}
