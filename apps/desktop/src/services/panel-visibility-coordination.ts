// Panel visibility mirror for stores that own a built-in panel's open state
// (draft editor, file viewer, terminal drawer). They must not import
// pluginStore directly (store-to-store imports are forbidden), so the write
// goes through this coordination service.
import { usePluginStore } from '../stores/pluginStore';

/** Built-in panel ids whose visibility is mirrored into pluginStore. */
export type BuiltinPanelId = 'draft' | 'file-viewer' | 'terminal';

export function setBuiltinPanelVisibility(panel: BuiltinPanelId, visible: boolean): void {
  usePluginStore.getState().updatePanelVisibility(panel, visible);
}
