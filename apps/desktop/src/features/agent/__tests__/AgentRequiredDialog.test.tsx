import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentRequiredDialog } from '../AgentRequiredDialog';

describe('AgentRequiredDialog', () => {
  it('renders the body for the given reason', () => {
    render(<AgentRequiredDialog open reason="no_credential" onClose={() => {}} onConfigure={() => {}} />);
    expect(screen.getByText(/API key/i)).toBeTruthy();
  });

  it('does not render when closed', () => {
    const { container } = render(<AgentRequiredDialog open={false} reason="no_agent" onClose={() => {}} onConfigure={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('primary button calls onConfigure with the mapped settings tab', () => {
    const onConfigure = vi.fn();
    render(<AgentRequiredDialog open reason="no_agent" onClose={() => {}} onConfigure={onConfigure} />);
    fireEvent.click(screen.getByText('Configure →'));
    expect(onConfigure).toHaveBeenCalledWith('agents');
  });

  it('secondary button calls onClose', () => {
    const onClose = vi.fn();
    render(<AgentRequiredDialog open reason="no_agent" onClose={onClose} onConfigure={() => {}} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
