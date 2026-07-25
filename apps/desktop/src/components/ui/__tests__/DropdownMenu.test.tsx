import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownMenu, type DropdownMenuEntry } from '../DropdownMenu';
import { IconButton } from '../Button';

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  const entries: DropdownMenuEntry[] = [
    { key: 'edit', label: 'Edit', onSelect: onEdit },
    'separator',
    { key: 'delete', label: 'Delete', destructive: true, onSelect: onDelete },
  ];
  render(
    <DropdownMenu
      entries={entries}
      ariaLabel="Card actions"
      trigger={({ ref, props }) => (
        <IconButton ref={ref} {...props} aria-label="Actions">
          …
        </IconButton>
      )}
    />
  );
  return { onEdit, onDelete };
}

describe('DropdownMenu', () => {
  it('opens on trigger click and renders role="menu" with items', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menu', { name: 'Card actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('fires onSelect and closes on item click', () => {
    const { onEdit } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves focus with arrow keys, skipping nothing enabled', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu');
    const [edit, del] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(del);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(edit);
  });

  it('closes on outside mousedown without firing items', () => {
    const { onEdit, onDelete } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('opens via ArrowDown on the closed trigger', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
