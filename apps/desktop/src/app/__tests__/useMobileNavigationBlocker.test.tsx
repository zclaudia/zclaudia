import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMobileNavigationBlocker } from '../useMobileNavigationBlocker';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
function Observer() {
  const blocked = useMobileNavigationBlocker();
  return <output data-testid="blocked">{String(blocked)}</output>;
}
function Fixture({ first = false, second = false }: { first?: boolean; second?: boolean }) {
  return <><Observer /><Modal open={first} onClose={() => {}} ariaLabel="First"><button>Action</button></Modal>
    <Modal open={second} onClose={() => {}} ariaLabel="Second">Second dialog</Modal></>;
}
describe('explicit navigation modal registry', () => {
  it('blocks for every open shared Modal and releases only after all close', () => {
    const view = render(<Fixture />);
    expect(screen.getByTestId('blocked').textContent).toBe('false');
    view.rerender(<Fixture first />);
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    view.rerender(<Fixture first second />);
    view.rerender(<Fixture second />);
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    view.rerender(<Fixture />);
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });
  it('registers Select and DropdownMenu only while their panels are open', () => {
    render(<><Observer />
      <Select value="a" onChange={() => {}} options={[{ value: 'a', label: 'Alpha' }]} ariaLabel="Choice" />
      <DropdownMenu ariaLabel="Actions" entries={[{ key: 'run', label: 'Run', onSelect: () => {} }]}
        trigger={({ ref, props }) => <button ref={ref} {...props}>Menu</button>} />
    </>);
    expect(screen.getByTestId('blocked').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Choice' }));
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.getByTestId('blocked').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run' }));
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });
  it('unregisters an open modal when its owner unmounts', () => {
    const observer = render(<Observer />);
    const modal = render(<Modal open onClose={() => {}} ariaLabel="Temporary">Body</Modal>);
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    modal.unmount();
    expect(screen.getByTestId('blocked').textContent).toBe('false');
    observer.unmount();
  });
});
