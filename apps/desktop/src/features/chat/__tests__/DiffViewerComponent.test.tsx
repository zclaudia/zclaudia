import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffViewer, UnifiedDiffViewer } from '../DiffViewer';

describe('DiffViewer component', () => {
  it('renders diff lines', () => {
    render(<DiffViewer oldString="old line" newString="new line" />);
    expect(screen.getByText('old line')).toBeInTheDocument();
    expect(screen.getByText('new line')).toBeInTheDocument();
  });

  it('renders file name from path', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="src/utils/helpers.ts" />);
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
  });

  it('names an unnamed diff generically', () => {
    render(<DiffViewer oldString="a" newString="b" />);
    expect(screen.getByText('diff')).toBeInTheDocument();
  });

  it('shows addition stats (green count)', () => {
    const { container } = render(<DiffViewer oldString="old" newString="new1\nnew2\nnew3" />);
    const greenSpan = container.querySelector('.ztk-diff__stat--added');
    expect(greenSpan).toBeInTheDocument();
  });

  it('shows removal stats (red count)', () => {
    const { container } = render(<DiffViewer oldString="old1\nold2\nold3" newString="new" />);
    const redSpan = container.querySelector('.ztk-diff__stat--removed');
    expect(redSpan).toBeInTheDocument();
  });

  it('shows + prefix for added lines', () => {
    render(<DiffViewer oldString="" newString="added" />);
    const plusElements = screen.getAllByText('+');
    expect(plusElements.length).toBeGreaterThan(0);
  });

  it('shows - prefix for removed lines', () => {
    render(<DiffViewer oldString="removed" newString="" />);
    const minusElements = screen.getAllByText('-');
    expect(minusElements.length).toBeGreaterThan(0);
  });

  it('handles identical strings (no +/- counts)', () => {
    const { container } = render(<DiffViewer oldString="same" newString="same" />);
    expect(container.querySelector('.ztk-diff__stat--added')).toBeNull();
    expect(container.querySelector('.ztk-diff__stat--removed')).toBeNull();
  });

  it('renders unchanged lines with space prefix', () => {
    const { container } = render(<DiffViewer oldString="same line" newString="same line" />);
    // Unchanged lines get a space prefix
    const lineSpans = container.querySelectorAll('span');
    const spaceSpans = Array.from(lineSpans).filter(s => s.textContent?.trim() === '');
    expect(spaceSpans.length).toBeGreaterThan(0);
  });

  it('renders multiple added and removed lines', () => {
    const { container } = render(<DiffViewer oldString="a\nb\nc" newString="a\nx\ny\nc" />);
    // Verify the diff renders both added and removed content
    const addedLines = container.querySelectorAll('.ztk-diff__line--added');
    const removedLines = container.querySelectorAll('.ztk-diff__line--removed');
    expect(addedLines.length).toBeGreaterThan(0);
    expect(removedLines.length).toBeGreaterThan(0);
  });

  it('shows correct add count in header', () => {
    const { container } = render(<DiffViewer oldString="" newString="line1\nline2" />);
    const greenSpan = container.querySelector('.ztk-diff__stat--added');
    expect(greenSpan?.textContent).toContain('+');
  });

  it('shows correct removal count in header', () => {
    const { container } = render(<DiffViewer oldString="line1\nline2\nline3" newString="" />);
    const redSpan = container.querySelector('.ztk-diff__stat--removed');
    // Verify that the removal count is displayed with a dash prefix
    expect(redSpan).not.toBeNull();
    expect(redSpan!.textContent).toContain('-');
  });

  it('marks removed lines distinctly from added ones', () => {
    const { container } = render(<DiffViewer oldString="to-remove" newString="new-line" />);
    expect(container.querySelector('.ztk-diff__line--removed')).toBeInTheDocument();
    expect(container.querySelector('.ztk-diff__line--added')).toBeInTheDocument();
  });

  it('applies green background to added lines', () => {
    const { container } = render(<DiffViewer oldString="" newString="added-line" />);
    const greenBg = container.querySelector('.ztk-diff__line--added');
    expect(greenBg).toBeInTheDocument();
  });

  it('applies red background to removed lines', () => {
    const { container } = render(<DiffViewer oldString="old-line" newString="" />);
    const redBg = container.querySelector('.ztk-diff__line--removed');
    expect(redBg).toBeInTheDocument();
  });

  it('handles deeply nested file path for display name', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="a/b/c/d/e/file.tsx" />);
    expect(screen.getByText('file.tsx')).toBeInTheDocument();
  });

  it('handles file path with no directory', () => {
    render(<DiffViewer oldString="a" newString="b" filePath="simple.ts" />);
    expect(screen.getByText('simple.ts')).toBeInTheDocument();
  });
});

describe('UnifiedDiffViewer component', () => {
  const unifiedDiff = ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1 +1 @@', '-old', '+new'].join(
    '\n'
  );

  it('renders unified diff lines with file name', () => {
    render(<UnifiedDiffViewer diff={unifiedDiff} filePath="src/app.ts" />);
    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getByText('-old')).toBeInTheDocument();
    expect(screen.getByText('+new')).toBeInTheDocument();
  });

  it('applies color classes to unified additions and removals', () => {
    const { container } = render(<UnifiedDiffViewer diff={unifiedDiff} />);
    expect(container.querySelector('.ztk-diff__line--added')).toBeInTheDocument();
    expect(container.querySelector('.ztk-diff__line--removed')).toBeInTheDocument();
  });
});
