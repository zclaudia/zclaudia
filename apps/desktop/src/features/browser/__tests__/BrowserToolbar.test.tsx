import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BrowserToolbar } from '../BrowserToolbar';

const state = { url: 'http://localhost:5173/', title: 'Vite', loading: false, canGoBack: true, canGoForward: false };

describe('BrowserToolbar', () => {
  it('shows the url and disables forward when canGoForward is false', () => {
    const { getByLabelText, getByDisplayValue } = render(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(getByDisplayValue('http://localhost:5173/')).toBeTruthy();
    expect((getByLabelText('Forward') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('Back') as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits the url on Enter', () => {
    const onNavigate = vi.fn();
    const { getByDisplayValue } = render(
      <BrowserToolbar state={state} agentActive={false} onNavigate={onNavigate} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    const input = getByDisplayValue('http://localhost:5173/') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'localhost:3100' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('localhost:3100');
  });

  it('shows stop while loading and reload otherwise', () => {
    const { getByLabelText, rerender } = render(
      <BrowserToolbar state={{ ...state, loading: true }} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(getByLabelText('Stop')).toBeTruthy();
    rerender(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(getByLabelText('Reload')).toBeTruthy();
  });

  it('element pick toggle reflects active state and fires the callback', () => {
    const onTogglePick = vi.fn();
    const { getByLabelText, rerender } = render(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={onTogglePick} onOpenExternal={() => {}} />
    );
    const btn = getByLabelText('Select element to chat') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onTogglePick).toHaveBeenCalledTimes(1);
    rerender(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={true} onTogglePick={onTogglePick} onOpenExternal={() => {}} />
    );
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('device emulation toggle reflects active state and fires the callback', () => {
    const onToggleEmulation = vi.fn();
    const { getByLabelText, rerender } = render(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={onToggleEmulation} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    const btn = getByLabelText('Toggle device emulation') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onToggleEmulation).toHaveBeenCalledTimes(1);
    rerender(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={true} onToggleEmulation={onToggleEmulation} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the agent indicator only when agentActive', () => {
    const { queryByText, rerender } = render(
      <BrowserToolbar state={state} agentActive={false} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(queryByText('Agent')).toBeNull();
    rerender(
      <BrowserToolbar state={state} agentActive={true} onNavigate={() => {}} onHistory={() => {}} onReload={() => {}} onStop={() => {}} emulationActive={false} onToggleEmulation={() => {}} pickActive={false} onTogglePick={() => {}} onOpenExternal={() => {}} />
    );
    expect(queryByText('Agent')).toBeTruthy();
  });
});
