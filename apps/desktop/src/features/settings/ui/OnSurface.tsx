import type { ReactNode } from 'react';
import { useSettingsSurface, type SettingsSurfaceId } from '../settingsSurface';

/** Renders its children only where `SETTINGS_SURFACES` says the entry belongs. */
export function OnSurface({ id, children }: { id: SettingsSurfaceId; children: ReactNode }) {
  const { visible } = useSettingsSurface(id);
  return visible ? <>{children}</> : null;
}
