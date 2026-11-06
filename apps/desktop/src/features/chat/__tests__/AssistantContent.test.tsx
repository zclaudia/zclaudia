import { useState, type ReactNode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReactMarkdown from 'react-markdown';
import type * as ReactMarkdownModule from 'react-markdown';
import { AssistantContent } from '../message-list/AssistantContent';
import { FileRefContext } from '../message-list/fileRefContext';

// Count actual parser invocations while retaining ReactMarkdown's reconciliation
// behavior: a stub that simply renders children cannot catch renderer remounts.
vi.mock('react-markdown', async importOriginal => {
  const actual = await importOriginal<typeof ReactMarkdownModule>();
  return { ...actual, default: vi.fn(actual.default) };
});

vi.mock('../../browser', () => ({
  ChatLink: ({ href, children }: { href?: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../CodeBlock', () => ({
  CodeBlock: ({ children }: { children: string }) => {
    const [copied, setCopied] = useState(false);
    return (
      <div data-testid="code-block">
        <button onClick={() => setCopied(true)}>{copied ? 'Copied' : 'Copy'}</button>
        <pre>
          <code>{children}</code>
        </pre>
      </div>
    );
  },
}));

vi.mock('../FileReference', () => ({
  MarkdownChildrenWithFileRefs: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../FileLineReference', () => ({
  INLINE_FILE_REF_REGEX: /^file\.tsx:\d+$/,
  FileLineReference: ({
    text,
    projectRoot,
    backendId,
  }: {
    text: string;
    projectRoot?: string;
    backendId?: string | null;
  }) => (
    <span data-testid="file-reference" data-root={projectRoot} data-backend={backendId}>
      {text}
    </span>
  ),
}));

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach(callback => callback(0)));
}

beforeEach(() => {
  vi.mocked(ReactMarkdown).mockClear();
  frames.clear();
  nextFrameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssistantContent streaming markdown', () => {
  it('retains earlier paragraph DOM and code block state when only the tail grows', () => {
    const prefix = 'A stable paragraph with `inline code`.\n\n```ts\nconst answer = 42;\n```\n\n';
    const { container, getByTestId, getByRole, rerender } = render(
      <AssistantContent content={`${prefix}Tail`} />
    );
    const paragraph = container.querySelector('p');
    const codeBlock = getByTestId('code-block');
    fireEvent.click(getByRole('button', { name: 'Copy' }));

    rerender(<AssistantContent content={`${prefix}Tail grows`} />);
    flushFrames();

    expect(container.querySelector('p')).toBe(paragraph);
    expect(getByTestId('code-block')).toBe(codeBlock);
    expect(getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Tail grows');
    const renders = vi.mocked(ReactMarkdown).mock.calls;
    expect(renders.at(-1)?.[0].components).toBe(renders[0][0].components);
    expect(renders.at(-1)?.[0].remarkPlugins).toBe(renders[0][0].remarkPlugins);
  });

  it('does no markdown work for raw updates before the frame commits and renders the latest final text', () => {
    const { container, rerender } = render(<AssistantContent content="Initial" />);
    flushFrames();
    expect(ReactMarkdown).toHaveBeenCalledTimes(1);

    rerender(<AssistantContent content="Initial draft" />);
    rerender(<AssistantContent content="Initial final **answer**" />);

    expect(ReactMarkdown).toHaveBeenCalledTimes(1);
    expect(container).toHaveTextContent('Initial');
    expect(container).not.toHaveTextContent('draft');
    expect(container).not.toHaveTextContent('answer');

    flushFrames();

    expect(ReactMarkdown).toHaveBeenCalledTimes(2);
    expect(container.querySelector('strong')).toHaveTextContent('answer');
    expect(container).toHaveTextContent('Initial final answer');
    expect(container).not.toHaveTextContent('draft');
  });

  it('skips equivalent context objects while updating file references when their scope changes', () => {
    const view = (projectRoot: string, backendId: string) => (
      <FileRefContext.Provider value={{ projectRoot, backendId }}>
        <AssistantContent content="See `file.tsx:2`." />
      </FileRefContext.Provider>
    );
    const { getByTestId, rerender } = render(view('/project-a', 'backend-a'));

    rerender(view('/project-a', 'backend-a'));
    expect(ReactMarkdown).toHaveBeenCalledTimes(1);

    rerender(view('/project-b', 'backend-b'));
    expect(getByTestId('file-reference')).toHaveAttribute('data-root', '/project-b');
    expect(getByTestId('file-reference')).toHaveAttribute('data-backend', 'backend-b');
    expect(ReactMarkdown).toHaveBeenCalledTimes(2);
  });
});
