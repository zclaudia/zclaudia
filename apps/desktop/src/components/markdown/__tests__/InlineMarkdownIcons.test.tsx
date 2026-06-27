import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownChildrenWithInlineIcons } from '../InlineMarkdownIcons';

describe('MarkdownChildrenWithInlineIcons', () => {
  afterEach(() => {
    cleanup();
  });

  it('replaces known emoji with inline lucide icons', () => {
    render(<MarkdownChildrenWithInlineIcons>{'2 ✅'}</MarkdownChildrenWithInlineIcons>);
    expect(screen.getByRole('img', { name: 'Completed' })).toBeInTheDocument();
  });

  it('replaces known emoji inside nested markdown elements', () => {
    render(
      <MarkdownChildrenWithInlineIcons>
        <strong>{'🟢 P3'}</strong>
      </MarkdownChildrenWithInlineIcons>
    );
    expect(screen.getByRole('img', { name: 'P3' })).toBeInTheDocument();
  });

  it('does not replace emoji inside code elements', () => {
    render(
      <MarkdownChildrenWithInlineIcons>
        <code>{'✅'}</code>
      </MarkdownChildrenWithInlineIcons>
    );
    expect(screen.queryByRole('img', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('replaces the stats emoji with an inline icon', () => {
    render(<MarkdownChildrenWithInlineIcons>{'📊 解决统计'}</MarkdownChildrenWithInlineIcons>);
    expect(screen.getByRole('img', { name: 'Stats' })).toBeInTheDocument();
  });

  it('replaces common technical markdown emoji', () => {
    render(<MarkdownChildrenWithInlineIcons>{'⚠️ check 🔧 config 📁 files 🚀 launch'}</MarkdownChildrenWithInlineIcons>);
    expect(screen.getByRole('img', { name: 'Warning' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Tool' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Folder' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Launch' })).toBeInTheDocument();
  });

  it('wraps unsupported emoji with the generic emoji fallback', () => {
    render(<MarkdownChildrenWithInlineIcons>{'plain 😀'}</MarkdownChildrenWithInlineIcons>);
    expect(screen.queryByRole('img', { name: 'Grinning face' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '😀' })).toBeInTheDocument();
  });

  it('wraps common service/tool emoji without adding them to the lucide map', () => {
    render(<MarkdownChildrenWithInlineIcons>{'🐦 🎮 🏠 ✉️ 📡 🎨 👁️ 🎬'}</MarkdownChildrenWithInlineIcons>);
    for (const emoji of ['🐦', '🎮', '🏠', '✉️', '📡', '🎨', '👁️', '🎬']) {
      expect(screen.getByRole('img', { name: emoji })).toBeInTheDocument();
    }
  });
});
