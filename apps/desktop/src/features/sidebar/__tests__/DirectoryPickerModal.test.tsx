import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DirectoryPickerModal } from '../DirectoryPickerModal';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({ browseDirectories: vi.fn() }));

const resp = (path: string, parent: string | null, dirs: string[]) => ({
  path,
  parent,
  directories: dirs.map((n) => ({ name: n, path: `${path}/${n}` })),
});

describe('DirectoryPickerModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and lists subdirectories of the initial path', async () => {
    vi.mocked(api.browseDirectories).mockResolvedValue(resp('/home/me', '/home', ['code', 'docs']));
    render(<DirectoryPickerModal open backendId={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(await screen.findByText('code')).toBeDefined();
    expect(screen.getByText('docs')).toBeDefined();
  });

  it('navigates into a clicked directory', async () => {
    vi.mocked(api.browseDirectories)
      .mockResolvedValueOnce(resp('/home/me', '/home', ['code']))
      .mockResolvedValueOnce(resp('/home/me/code', '/home/me', ['app']));
    render(<DirectoryPickerModal open backendId={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByText('code'));
    await waitFor(() =>
      expect(api.browseDirectories).toHaveBeenLastCalledWith({ path: '/home/me/code', backendId: null }),
    );
  });

  it('goes up to the parent directory', async () => {
    vi.mocked(api.browseDirectories)
      .mockResolvedValueOnce(resp('/home/me', '/home', ['code']))
      .mockResolvedValueOnce(resp('/home', '/', ['me']));
    render(<DirectoryPickerModal open backendId={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText('code');
    fireEvent.click(screen.getByRole('button', { name: 'Up one level' }));
    await waitFor(() =>
      expect(api.browseDirectories).toHaveBeenLastCalledWith({ path: '/home', backendId: null }),
    );
  });

  it('disables Up at the filesystem root', async () => {
    vi.mocked(api.browseDirectories).mockResolvedValue(resp('/', null, ['home']));
    render(<DirectoryPickerModal open backendId={null} onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText('home');
    expect(screen.getByRole('button', { name: 'Up one level' })).toHaveProperty('disabled', true);
  });

  it('selects the current folder and closes', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api.browseDirectories).mockResolvedValue(resp('/home/me', '/home', []));
    render(<DirectoryPickerModal open backendId={null} onClose={onClose} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this folder' }));
    expect(onSelect).toHaveBeenCalledWith('/home/me');
    expect(onClose).toHaveBeenCalled();
  });

  it('seeds the browse from the initial path', async () => {
    vi.mocked(api.browseDirectories).mockResolvedValue(resp('/work/proj', '/work', []));
    render(<DirectoryPickerModal open backendId="b1" initialPath="/work/proj" onClose={vi.fn()} onSelect={vi.fn()} />);
    await waitFor(() =>
      expect(api.browseDirectories).toHaveBeenCalledWith({ path: '/work/proj', backendId: 'b1' }),
    );
  });
});
