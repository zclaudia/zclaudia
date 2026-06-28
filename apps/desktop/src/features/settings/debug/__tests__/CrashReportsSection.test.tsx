import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getCrashReports = vi.fn().mockResolvedValue({ reports: [], filePath: '/tmp/crash.jsonl' });
vi.mock('../../../../services/api', () => ({ getCrashReports: () => getCrashReports() }));

import { CrashReportsSection } from '../CrashReportsSection';

describe('CrashReportsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads on mount and shows the empty state + path', async () => {
    render(<CrashReportsSection embeddedServerStatus="running" />);
    await waitFor(() => expect(getCrashReports).toHaveBeenCalled());
    expect(screen.getByText('No crash reports recorded.')).toBeTruthy();
    expect(await screen.findByText('/tmp/crash.jsonl')).toBeTruthy();
  });

  it('does not load when the embedded server is disabled', () => {
    render(<CrashReportsSection embeddedServerStatus="disabled" />);
    expect(getCrashReports).not.toHaveBeenCalled();
  });
});
