// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchemaForm, missingRequiredKeys } from '../SchemaForm';

const schema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Commit message' },
    body: { type: 'string', format: 'multiline' },
    messageMode: { type: 'string', enum: ['stat', 'explicit'] },
    retries: { type: 'number' },
    stageAll: { type: 'boolean' },
  },
  required: ['message'],
};

describe('missingRequiredKeys', () => {
  it('returns required keys that are empty or missing', () => {
    expect(missingRequiredKeys(schema, {})).toEqual(['message']);
    expect(missingRequiredKeys(schema, { message: '' })).toEqual(['message']);
    expect(missingRequiredKeys(schema, { message: 'hi' })).toEqual([]);
  });
  it('handles undefined schema', () => {
    expect(missingRequiredKeys(undefined, {})).toEqual([]);
  });
});

describe('SchemaForm', () => {
  it('renders a control per property and emits changes', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} value={{}} onChange={onChange} />);

    // text input for string
    const message = screen.getByLabelText('message');
    fireEvent.change(message, { target: { value: 'feat: x' } });
    expect(onChange).toHaveBeenCalledWith({ message: 'feat: x' });

    // textarea for multiline
    expect((screen.getByLabelText('body') as HTMLElement).tagName).toBe('TEXTAREA');

    // select for enum
    expect((screen.getByLabelText('messageMode') as HTMLElement).tagName).toBe('SELECT');

    // number input
    expect(screen.getByLabelText('retries')).toHaveAttribute('type', 'number');

    // checkbox for boolean
    expect(screen.getByLabelText('stageAll')).toHaveAttribute('type', 'checkbox');
  });

  it('renders nothing for empty properties', () => {
    const { container } = render(
      <SchemaForm
        schema={{ type: 'object', properties: {}, required: [] }}
        value={{}}
        onChange={() => {}}
      />
    );
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0);
  });
});
