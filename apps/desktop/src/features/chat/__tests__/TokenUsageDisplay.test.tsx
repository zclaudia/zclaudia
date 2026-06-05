import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TokenUsageDisplay } from '../TokenUsageDisplay';

describe('TokenUsageDisplay', () => {
  it('returns null when all tokens are 0', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={0} outputTokens={0} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders token counts', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={1500} outputTokens={500} />
    );
    expect(container.textContent).toContain('2K/--');
  });

  it('formats millions', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={1500000} outputTokens={0} />
    );
    expect(container.textContent).toContain('1.5M');
  });

  it('shows context window ratio', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={80000} outputTokens={0} contextWindow={100000} />
    );
    expect(container.textContent).toContain('80K/100K');
  });

  it('applies destructive class when ratio > 0.8', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={90000} outputTokens={0} contextWindow={100000} />
    );
    expect(container.innerHTML).toContain('text-destructive');
  });

  it('uses latestInputTokens when provided', () => {
    const { container } = render(
      <TokenUsageDisplay
        inputTokens={5000}
        outputTokens={1000}
        latestInputTokens={2000}
        latestOutputTokens={500}
      />
    );
    expect(container.textContent).toContain('2K/--');
  });

  // F2/F4: surface where the context-window number came from.
  describe('contextWindowSource', () => {
    it('renders the profile_entry tooltip on the value when source is profile_entry', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={200_000}
          contextWindowSource="profile_entry"
        />
      );
      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan).toBeTruthy();
      expect(valueSpan!.getAttribute('title')).toMatch(/LLM profile model override/i);
    });

    it('renders the registry tooltip without matchedProvider when source is pi_ai_registry alone', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={200_000}
          contextWindowSource="pi_ai_registry"
        />
      );
      const valueSpan = container.querySelector('span[title]');
      // Don't mention "pi-ai" in the user-facing string per F4 UX.
      const title = valueSpan!.getAttribute('title') ?? '';
      expect(title).toMatch(/from registry/i);
      expect(title).not.toMatch(/pi-ai/i);
      // No parenthetical when matchedProvider is absent.
      expect(title).not.toMatch(/\(.+\)/);
    });

    it('renders the registry tooltip with matchedProvider annotation when set', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={131_072}
          contextWindowSource="pi_ai_registry"
          contextWindowMatchedProvider="deepseek"
        />
      );
      const valueSpan = container.querySelector('span[title]');
      const title = valueSpan!.getAttribute('title') ?? '';
      expect(title).toMatch(/from registry \(deepseek\)/i);
      expect(title).not.toMatch(/pi-ai/i);
    });

    it('renders the openai_compat_default warning icon + actionable tooltip', () => {
      const { container, getByLabelText } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={128_000}
          contextWindowSource="openai_compat_default"
        />
      );
      const iconWrapper = getByLabelText(/openai-compat default/i);
      expect(iconWrapper).toBeInTheDocument();
      const tip = iconWrapper.getAttribute('title') ?? '';
      expect(tip).toMatch(/128,000 default for openai-compat/i);
      expect(tip).toMatch(/declare the model on your LLM profile/i);
      const svg = iconWrapper.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('class')).toMatch(/text-amber-500/);

      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan!.getAttribute('title') ?? '').toMatch(/128,000 default for openai-compat/i);
    });

    it('renders the fallback warning icon + actionable tooltip on the fallback path', () => {
      const { container, getByLabelText } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={100_000}
          contextWindowSource="fallback"
        />
      );
      const iconWrapper = getByLabelText('Context window is a fallback estimate');
      expect(iconWrapper).toBeInTheDocument();
      expect(iconWrapper.getAttribute('title')).toMatch(/Declare the model on your LLM profile/i);
      const svg = iconWrapper.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('class')).toMatch(/text-amber-500/);

      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan!.getAttribute('title')).toMatch(/Declare the model on your LLM profile/i);
    });

    it('does NOT render the fallback warning icon when source is not fallback / openai_compat_default', () => {
      const { queryByLabelText } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={100_000}
          contextWindowSource="pi_ai_registry"
        />
      );
      expect(queryByLabelText('Context window is a fallback estimate')).toBeNull();
      expect(queryByLabelText(/openai-compat default/i)).toBeNull();
    });
  });
});
