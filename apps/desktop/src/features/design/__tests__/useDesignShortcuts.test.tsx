import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDesignShortcuts } from '../hooks/useDesignShortcuts';

function Harness(props: {
  dirty?: boolean;
  busy?: boolean;
  editable?: boolean;
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  useDesignShortcuts({
    enabled: true,
    dirty: props.dirty ?? true,
    busy: props.busy ?? false,
    onSave: props.onSave ?? (() => undefined),
    onUndo: props.onUndo ?? (() => undefined),
    onRedo: props.onRedo ?? (() => undefined),
  });
  return (
    <div data-testid="design-panel">
      <button type="button">focus target</button>
      <input aria-label="Field" />
      {props.editable && <textarea aria-label="Editor" />}
    </div>
  );
}

describe('useDesignShortcuts（P6 面板作用域快捷键）', () => {
  it('焦点不在面板内时不拦截', () => {
    const onSave = vi.fn();
    render(
      <div>
        <Harness onSave={onSave} />
        <button type="button">outside</button>
      </div>
    );
    (screen.getByRole('button', { name: 'outside' }) as HTMLButtonElement).focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('面板内 ⌘S 保存（仅 dirty 且非 busy）', () => {
    const onSave = vi.fn();
    const view = render(<Harness onSave={onSave} />);
    screen.getByRole('button', { name: 'focus target' }).focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);

    view.rerender(<Harness onSave={onSave} dirty={false} />);
    screen.getByRole('button', { name: 'focus target' }).focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);

    view.rerender(<Harness onSave={onSave} busy />);
    screen.getByRole('button', { name: 'focus target' }).focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('⌘Z / ⇧⌘Z 在非编辑控件上触发撤销重做；输入框内让位给原生撤销', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const view = render(<Harness onUndo={onUndo} onRedo={onRedo} />);
    screen.getByRole('button', { name: 'focus target' }).focus();
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);

    view.rerender(<Harness onUndo={onUndo} onRedo={onRedo} />);
    screen.getByRole('textbox', { name: 'Field' }).focus();
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl 同样生效（非 macOS）', () => {
    const onUndo = vi.fn();
    render(<Harness onUndo={onUndo} />);
    screen.getByRole('button', { name: 'focus target' }).focus();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
