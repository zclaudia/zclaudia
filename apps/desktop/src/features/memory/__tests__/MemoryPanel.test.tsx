import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel } from '../MemoryPanel';
import { useFileViewerStore } from '../../../stores/fileViewerStore';

vi.mock('../../../services/api/memory', () => ({
  getProjectMemoryDir: vi.fn(async () => ({ memoryDir: '/data/memory/p1' })),
}));

vi.mock('../../../services/api/files', () => ({
  listDirectory: vi.fn(async () => ({
    entries: [
      { name: 'MEMORY.md', path: 'MEMORY.md', type: 'file' },
      { name: 'layout.md', path: 'layout.md', type: 'file' },
    ],
    currentPath: '',
    hasMore: false,
  })),
}));

describe('MemoryPanel', () => {
  beforeEach(() => {
    useFileViewerStore.setState({ isOpen: false, filePath: null } as any);
  });

  it('lists memory files for the project', async () => {
    render(<MemoryPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('layout.md')).toBeInTheDocument());
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument();
  });

  it('opens a memory file in the file viewer on click', async () => {
    render(<MemoryPanel projectId="p1" />);
    await waitFor(() => screen.getByText('layout.md'));
    await userEvent.click(screen.getByText('layout.md'));
    const state = useFileViewerStore.getState();
    expect(state.filePath).toBe('layout.md');
  });

  it('shows an empty state when no project', async () => {
    render(<MemoryPanel />);
    await waitFor(() => expect(screen.getByText(/暂无记忆/)).toBeInTheDocument());
  });
});
