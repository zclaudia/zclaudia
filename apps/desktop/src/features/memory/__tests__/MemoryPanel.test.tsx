import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel } from '../MemoryPanel';

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
  getFileContent: vi.fn(async ({ relativePath }: { relativePath: string }) => ({
    path: relativePath,
    content: `# Content of ${relativePath}`,
    size: 42,
  })),
}));

vi.mock('../../../stores/ownershipStore', () => ({
  useOwnershipStore: (selector: (s: { getProjectBackendId: () => null }) => unknown) =>
    selector({ getProjectBackendId: () => null }),
}));

describe('MemoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists memory files for the project', async () => {
    render(<MemoryPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('layout.md')).toBeInTheDocument());
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument();
  });

  it('clicking a file shows an inline detail view with file content', async () => {
    render(<MemoryPanel projectId="p1" />);
    await waitFor(() => screen.getByText('layout.md'));
    await userEvent.click(screen.getByText('layout.md'));
    expect(await screen.findByText('# Content of layout.md')).toBeInTheDocument();
    expect(screen.getByText('layout.md', { selector: 'span' })).toBeInTheDocument();
  });

  it('back button returns to the file list from detail view', async () => {
    render(<MemoryPanel projectId="p1" />);
    await waitFor(() => screen.getByText('layout.md'));
    await userEvent.click(screen.getByText('layout.md'));
    await screen.findByText('# Content of layout.md');
    await userEvent.click(screen.getByText('← Back'));
    await waitFor(() => expect(screen.getByText('layout.md')).toBeInTheDocument());
    expect(screen.getByText('MEMORY.md')).toBeInTheDocument();
  });

  it('shows an empty state when no project', async () => {
    render(<MemoryPanel />);
    await waitFor(() =>
      expect(
        screen.getByText(/No memories yet — the agent saves project memory here as it works\./)
      ).toBeInTheDocument()
    );
  });
});
