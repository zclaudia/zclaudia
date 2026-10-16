import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { useRuntimeDescriptorStore } from '../../../stores/runtimeDescriptorStore';
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

function descriptor(
  runtime: string,
  additionalDirectories?: 'native' | 'host' | 'none'
): ProfileConfigDescriptor {
  return {
    runtime,
    label: runtime === 'legacy' ? 'Legacy Agent' : 'Other Agent',
    enabled: true,
    model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'off' },
    hasCliPath: false,
    capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
    ...(additionalDirectories ? { additionalDirectories } : {}),
  };
}

describe('AdditionalDirectoriesField runtime hint', () => {
  beforeEach(() => {
    useRuntimeDescriptorStore.setState({
      byBackend: {
        local: [
          descriptor('other', 'none'),
          descriptor('native-rt', 'native'),
          descriptor('host-rt', 'host'),
          descriptor('legacy'),
        ],
      },
    });
  });

  const renderField = (agentRuntimeType: string | undefined, rootPath = '/root') =>
    render(
      <AdditionalDirectoriesField
        value={[]}
        onChange={() => {}}
        backendId="local"
        rootPath={rootPath}
        agentRuntimeType={agentRuntimeType}
      />
    );

  it('warns when the agent runtime does not support additional directories', () => {
    renderField('other');
    expect(screen.getByRole('status')).toHaveTextContent(
      "Other Agent can't use additional directories directly"
    );
  });

  it.each(['native-rt', 'host-rt'])('stays quiet for %s', runtime => {
    renderField(runtime);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('treats a missing field (older backend), an unknown runtime and no runtime as unknown', () => {
    for (const runtime of ['legacy', 'never-registered', undefined]) {
      const { unmount } = renderField(runtime);
      expect(screen.queryByRole('status')).toBeNull();
      unmount();
    }
  });

  it('does not warn before a working directory is set', () => {
    renderField('other', '');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
