import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, IconButton } from '../Button';

describe('Button', () => {
  it('renders a type="button" ghost button by default', () => {
    render(<Button>Cancel</Button>);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('hover:bg-secondary');
  });

  it('applies the primary variant recipe', () => {
    render(<Button variant="primary">Create</Button>);
    const btn = screen.getByRole('button', { name: 'Create' });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-primary-foreground');
  });

  it('has a focus-visible ring and unified disabled treatment', () => {
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('focus-visible:ring-1');
    expect(btn.className).toContain('disabled:opacity-50');
    expect(btn).toBeDisabled();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('merges caller className after the recipe', () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole('button', { name: 'Wide' }).className).toMatch(/w-full$/);
  });
});

describe('IconButton', () => {
  it('requires an accessible name and renders square', () => {
    render(<IconButton aria-label="Close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('h-7 w-7');
  });

  it('supports the small size', () => {
    render(<IconButton size="sm" aria-label="Dismiss" />);
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toContain('h-6 w-6');
  });
});
