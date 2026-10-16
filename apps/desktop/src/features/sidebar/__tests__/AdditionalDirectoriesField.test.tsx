import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdditionalDirectoriesField, cleanAdditionalPaths } from '../AdditionalDirectoriesField';

// The real picker browses a backend filesystem; here it just exposes onSelect.
vi.mock('../DirectoryPickerModal', () => ({
  DirectoryPickerModal: ({
    open,
    initialPath,
    onSelect,
  }: {
    open: boolean;
    initialPath?: string;
    onSelect: (p: string) => void;
  }) =>
    open ? (
      <div data-testid="picker" data-initial={initialPath ?? ''}>
        <button onClick={() => onSelect('/picked/dir')}>pick</button>
      </div>
    ) : null,
}));

describe('AdditionalDirectoriesField', () => {
  it('appends the picked directory and ignores duplicates', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AdditionalDirectoriesField
        value={['/a']}
        onChange={onChange}
        backendId="local"
        rootPath="/root"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Add directory/ }));
    expect(screen.getByTestId('picker')).toHaveAttribute('data-initial', '/root');
    fireEvent.click(screen.getByText('pick'));
    expect(onChange).toHaveBeenCalledWith(['/a', '/picked/dir']);

    onChange.mockClear();
    rerender(
      <AdditionalDirectoriesField
        value={['/picked/dir']}
        onChange={onChange}
        backendId="local"
        rootPath="/root"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Add directory/ }));
    fireEvent.click(screen.getByText('pick'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('replaces a row when browsing from it', () => {
    const onChange = vi.fn();
    render(
      <AdditionalDirectoriesField
        value={['/a', '/b']}
        onChange={onChange}
        backendId={null}
        rootPath="/root"
      />
    );
    fireEvent.click(screen.getByLabelText('Browse for additional directory 2'));
    expect(screen.getByTestId('picker')).toHaveAttribute('data-initial', '/b');
    fireEvent.click(screen.getByText('pick'));
    expect(onChange).toHaveBeenCalledWith(['/a', '/picked/dir']);
  });

  it('cleanAdditionalPaths trims and drops blanks', () => {
    expect(cleanAdditionalPaths([' /a ', '', '   ', '/b'])).toEqual(['/a', '/b']);
  });
});
