import { useEffect } from 'react';

export interface DesignShortcutsOptions {
  /** 面板可见且挂载时才接快捷键。 */
  enabled: boolean;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const PANEL_SELECTOR = '[data-testid="design-panel"]';

function isEditable(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return (element as HTMLElement).isContentEditable;
}

/**
 * 面板作用域快捷键（P6 §5）：⌘/Ctrl+S 保存、⌘/Ctrl+Z 撤销、⇧⌘/Ctrl+Z 重做。
 * 只在焦点位于面板内时生效；预览 iframe 内的按键不冒泡，仍交给 iframe。
 * 撤销/重做在可编辑控件内让位给原生文本撤销。
 */
export function useDesignShortcuts({
  enabled,
  dirty,
  busy,
  onSave,
  onUndo,
  onRedo,
}: DesignShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const active = document.activeElement;
      if (!active?.closest(PANEL_SELECTOR)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (dirty && !busy) onSave();
        return;
      }
      if (key !== 'z' || isEditable(active)) return;
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, dirty, busy, onSave, onUndo, onRedo]);
}
