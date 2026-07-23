import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownChildrenWithInlineIcons } from '../InlineMarkdownIcons';

function getCssRule(selector: string) {
  const css = readFileSync('src/styles/index.css', 'utf8');
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]+)\\}`));
  return match?.groups?.body ?? '';
}

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
    render(
      <MarkdownChildrenWithInlineIcons>
        {'⚠️ check 🔧 config 📁 files 🚀 launch'}
      </MarkdownChildrenWithInlineIcons>
    );
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

  it('centers fallback emoji on the surrounding text line', () => {
    const rule = getCssRule('.inline-markdown-emoji');
    expect(rule).toContain('vertical-align: middle;');
    expect(rule).not.toContain('vertical-align: -0.125em;');
  });

  it('renders numeric keycap emoji as app-native centered chips', () => {
    render(<MarkdownChildrenWithInlineIcons>{'1️⃣ `tool`'}</MarkdownChildrenWithInlineIcons>);

    const keycap = screen.getByRole('img', { name: '1️⃣' });
    expect(keycap).toHaveClass('inline-markdown-keycap');
    expect(keycap).toHaveTextContent('1');
    expect(keycap).not.toHaveTextContent('1️⃣');

    const rule = getCssRule('.inline-markdown-keycap');
    expect(rule).toContain('height: 1.375em;');
    expect(rule).toContain('align-items: center;');
    expect(rule).toContain('vertical-align: 0.04em;');
  });

  it('centers lucide-backed emoji icons on the surrounding text line', () => {
    render(<MarkdownChildrenWithInlineIcons>{'2 ✅ done'}</MarkdownChildrenWithInlineIcons>);

    const icon = screen.getByRole('img', { name: 'Completed' });
    expect(icon).toHaveClass('align-middle');
    expect(icon.getAttribute('class')).not.toContain('align-[-0.125em]');
  });

  it('wraps common service/tool emoji without adding them to the lucide map', () => {
    render(
      <MarkdownChildrenWithInlineIcons>{'🐦 🎮 🏠 ✉️ 📡 🎨 👁️ 🎬'}</MarkdownChildrenWithInlineIcons>
    );
    for (const emoji of ['🐦', '🎮', '🏠', '✉️', '📡', '🎨', '👁️', '🎬']) {
      expect(screen.getByRole('img', { name: emoji })).toBeInTheDocument();
    }
  });

  it('keeps Unicode tag-sequence flag subdivisions intact (no stray tag chars)', () => {
    // England flag = U+1F3F4 + tag letters gbeng + cancel tag, built from
    // codepoints to avoid editors/shell stripping the invisible tag chars.
    const england = `${String.fromCodePoint(0x1f3f4)}${String.fromCodePoint(
      0xe0067,
      0xe0062,
      0xe0065,
      0xe006e,
      0xe0067,
      0xe007f
    )}`;
    render(<MarkdownChildrenWithInlineIcons>{`flag ${england}`}</MarkdownChildrenWithInlineIcons>);

    // The entire subdivision flag is wrapped as one img role with the full
    // sequence as its accessible name — the tag characters must not leak out.
    expect(screen.getByRole('img', { name: england })).toBeInTheDocument();
    // No stray tag/control characters rendered as visible text.
    expect(document.body.textContent).not.toMatch(new RegExp(String.fromCodePoint(0xe0067)));
  });
});
