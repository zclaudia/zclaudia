import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';
import { TranscriptCapabilitiesProvider } from '../TranscriptCapabilities';

// Purity contract: no store mocks, no app-context mocks. The block renders
// from props plus the transcript capabilities context that travels with it
// into the shared component layer.

function renderBlock(
  capabilities: { runInTerminal?: (command: string) => void; isDarkCode?: boolean } = {},
  { language = 'bash', code = 'npm test' } = {}
) {
  return render(
    <TranscriptCapabilitiesProvider value={capabilities}>
      <CodeBlock language={language}>{code}</CodeBlock>
    </TranscriptCapabilitiesProvider>
  );
}

describe('CodeBlock (pure)', () => {
  it('renders language and code with no providers at all', () => {
    render(<CodeBlock language="python">print(1)</CodeBlock>);
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('Copy code')).toBeInTheDocument();
  });

  it('offers "Run in terminal" for shell code only when the host can run it', () => {
    const runInTerminal = vi.fn();
    renderBlock({ runInTerminal });
    fireEvent.click(screen.getByText('Run in terminal'));
    expect(runInTerminal).toHaveBeenCalledWith('npm test');
  });

  it('hides "Run in terminal" without the capability', () => {
    renderBlock({});
    expect(screen.queryByText('Run in terminal')).not.toBeInTheDocument();
  });

  it('hides "Run in terminal" for non-shell languages even with the capability', () => {
    renderBlock({ runInTerminal: vi.fn() }, { language: 'python', code: 'print(1)' });
    expect(screen.queryByText('Run in terminal')).not.toBeInTheDocument();
  });
});
