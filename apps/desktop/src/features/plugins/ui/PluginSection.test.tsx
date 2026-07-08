import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginSection } from './PluginSection';

describe('PluginSection', () => {
  it('renders label with count and children', () => {
    render(
      <PluginSection label="Built-in" count={2}>
        <div>card</div>
      </PluginSection>
    );
    expect(screen.getByText('Built-in · 2')).toBeInTheDocument();
    expect(screen.getByText('card')).toBeInTheDocument();
  });

  it('renders the empty state when isEmpty', () => {
    render(
      <PluginSection label="Installed" count={0} isEmpty emptyText="No plugins installed." />
    );
    expect(screen.getByText('Installed · 0')).toBeInTheDocument();
    expect(screen.getByText('No plugins installed.')).toBeInTheDocument();
  });
});
