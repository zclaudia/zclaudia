import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BrowserEngineGate } from '../BrowserEngineGate';

describe('BrowserEngineGate', () => {
  it('offers download when engine is missing', () => {
    const onInstall = vi.fn();
    const { getByRole } = render(
      <BrowserEngineGate engine={{ status: 'missing' }} onInstall={onInstall} />
    );
    fireEvent.click(getByRole('button', { name: 'Download Chromium' }));
    expect(onInstall).toHaveBeenCalled();
  });

  it('shows progress while downloading', () => {
    const { getByText } = render(
      <BrowserEngineGate engine={{ status: 'downloading', progress: 0.42 }} onInstall={() => {}} />
    );
    expect(getByText('42%')).toBeTruthy();
  });

  it('shows the error message on error', () => {
    const { getByText } = render(
      <BrowserEngineGate engine={{ status: 'error', message: 'network down' }} onInstall={() => {}} />
    );
    expect(getByText('network down')).toBeTruthy();
  });
});
