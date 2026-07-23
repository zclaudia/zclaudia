import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetailHeader } from './DetailHeader';

describe('DetailHeader', () => {
  it('renders breadcrumb, title, badges and fires back', () => {
    const onBack = vi.fn();
    render(
      <DetailHeader
        crumb="Profiles"
        title="Coding"
        badges={[
          { label: 'This Device', online: true },
          { label: 'Default', tone: 'accent' },
        ]}
        onBack={onBack}
      />
    );
    expect(screen.getByText('Coding')).toBeInTheDocument();
    expect(screen.getByText('This Device')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Profiles|Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
