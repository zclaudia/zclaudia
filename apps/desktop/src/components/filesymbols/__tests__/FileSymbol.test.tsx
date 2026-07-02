import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FileSymbol } from '../FileSymbol';

describe('FileSymbol', () => {
  it('renders glyph-token-colored svg with no raw hex paint', () => {
    const { container } = render(<FileSymbol name="index.ts" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.innerHTML).toContain('hsl(var(--glyph-');
    // Attribute-level hex exists only inside <mask> shapes; visible paint is style-attr by construction (enforced by the generator tests).
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]{6}/);
  });

  it('keeps the wrapper span + className contract', () => {
    const { container } = render(<FileSymbol name="a.md" className="wrapper" />);
    const span = container.querySelector('span.wrapper');
    expect(span).not.toBeNull();
    expect(span!.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies size to the wrapper when given', () => {
    const { container } = render(<FileSymbol name="a.md" size={16} />);
    const span = container.querySelector('span')!;
    expect(span.style.width).toBe('16px');
    expect(span.style.height).toBe('16px');
  });

  it('falls back to the document symbol for unknown names', () => {
    const { container } = render(<FileSymbol name="mystery.xyz" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
