// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useIsMobile = vi.fn(() => false);
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => useIsMobile() }));

import { OnSurface } from '../ui/OnSurface';
import {
  SETTINGS_SURFACES,
  isVisibleOnSurface,
  isReadOnlyOnSurface,
  isCollapsedOnSurface,
  useSettingsSurface,
  type SettingsSurfaceId,
} from '../settingsSurface';

const ids = Object.keys(SETTINGS_SURFACES) as SettingsSurfaceId[];

describe('SETTINGS_SURFACES', () => {
  it('explains every restriction it declares', () => {
    // A restricted entry without a reason is an undocumented decision — the
    // point of the table is that it reads as the review that produced it.
    const unexplained = ids.filter(id => {
      const def = SETTINGS_SURFACES[id];
      const restricted = def.surface !== 'both' || 'readOnlyOn' in def || 'collapsedOn' in def;
      return restricted && !('why' in def);
    });
    expect(unexplained).toEqual([]);
  });

  it('keeps the phone-critical adjudication rows on mobile', () => {
    for (const id of [
      'permissions.auto-approve',
      'permissions.categories',
      'permissions.safety-guards',
      'gateway.config',
      'debug.permission-logs',
    ] as SettingsSurfaceId[]) {
      expect(isVisibleOnSurface(id, true)).toBe(true);
    }
  });

  it('keeps host administration off mobile', () => {
    for (const id of [
      'agent.managed-clis',
      'agent.capabilities',
      'debug.process-cleanup',
      'debug.ai-review-simulator',
      'general.notch-panel',
    ] as SettingsSurfaceId[]) {
      expect(isVisibleOnSurface(id, true)).toBe(false);
      expect(isVisibleOnSurface(id, false)).toBe(true);
    }
  });

  it('shows the authoring surfaces on mobile but does not let them be edited', () => {
    for (const id of ['permissions.tool-rules', 'permissions.hooks'] as SettingsSurfaceId[]) {
      expect(isVisibleOnSurface(id, true)).toBe(true);
      expect(isReadOnlyOnSurface(id, true)).toBe(true);
      expect(isReadOnlyOnSurface(id, false)).toBe(false);
    }
  });

  it('collapses the AI review knobs on mobile only', () => {
    expect(isCollapsedOnSurface('permissions.ai-review-tuning', true)).toBe(true);
    expect(isCollapsedOnSurface('permissions.ai-review-tuning', false)).toBe(false);
  });
});

describe('OnSurface', () => {
  function Probe({ id }: { id: SettingsSurfaceId }) {
    const { readOnly } = useSettingsSurface(id);
    return <span>{readOnly ? 'read-only' : 'editable'}</span>;
  }

  it('renders desktop-only children on desktop and drops them on mobile', () => {
    useIsMobile.mockReturnValue(false);
    const { unmount } = render(
      <OnSurface id="debug.process-cleanup">
        <span>cleanup</span>
      </OnSurface>
    );
    expect(screen.getByText('cleanup')).toBeInTheDocument();
    unmount();

    useIsMobile.mockReturnValue(true);
    render(
      <OnSurface id="debug.process-cleanup">
        <span>cleanup</span>
      </OnSurface>
    );
    expect(screen.queryByText('cleanup')).toBeNull();
  });

  it('reports read-only through the hook on the declared surface', () => {
    useIsMobile.mockReturnValue(true);
    const { unmount } = render(<Probe id="permissions.hooks" />);
    expect(screen.getByText('read-only')).toBeInTheDocument();
    unmount();

    useIsMobile.mockReturnValue(false);
    render(<Probe id="permissions.hooks" />);
    expect(screen.getByText('editable')).toBeInTheDocument();
  });
});
