// Active-backend access for stores that must not import serverStore directly
// (store-to-store imports are forbidden; services coordinate stores).
// The optional-call style mirrors the defensive access the stores used
// before, so partially mocked stores in tests (getState only) keep working.
import { useServerStore } from '../stores/serverStore';

export function getActiveServerId(): string | null {
  const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } })
    .getState;
  return getState?.().activeServerId ?? null;
}
