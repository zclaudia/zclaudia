import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from '../FormField';

describe('FormField', () => {
  it('associates the label with the control', () => {
    render(
      <FormField label="Project name" required>
        {f => <input {...f} />}
      </FormField>
    );
    const input = screen.getByLabelText(/project name/i);
    expect(input).toBeTruthy();
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('wires the error via aria-describedby + aria-invalid', () => {
    render(
      <FormField label="URL" error="Must be https">
        {f => <input {...f} />}
      </FormField>
    );
    const input = screen.getByLabelText('URL');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('Must be https');
    expect(screen.getByRole('alert').textContent).toBe('Must be https');
  });

  it('omits error wiring when there is no error', () => {
    render(<FormField label="Name">{f => <input {...f} />}</FormField>);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
