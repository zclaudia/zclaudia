import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  // Prompt-cache hit badge
  describe('cache hit badge', () => {
    it('renders ↺ badge with compact number when latestCacheReadTokens > 0', () => {
      const { getByLabelText, container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          latestCacheReadTokens={38200}
        />
      );
      const badge = getByLabelText('Prompt cache hit');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toContain('↺');
      // formatTokenCount produces "38K" for 38200
      expect(badge.textContent).toContain('38K');
      expect(badge.getAttribute('title')).toMatch(/38,200 tokens read from cache/i);
    });

    it('does not render ↺ badge when latestCacheReadTokens is absent', () => {
      const { container } = render(
        <TokenUsageDisplay inputTokens={10_000} outputTokens={0} />
      );
      expect(container.textContent).not.toContain('↺');
    });
  });

  // F2/F4: surface where the context-window number came from.
  describe('contextWindowSource', () => {
    it('renders the profile_entry tooltip — no title on the value span (popover owns it)', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={200_000}
          contextWindowSource="profile_entry"
        />
      );
      // The value span no longer carries a title (popover replaced it).
      // There should be no span[title] since profile_entry has no warning icon.
      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan).toBeNull();
    });

    it('renders the registry tooltip without matchedProvider — no title on the value span', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={200_000}
          contextWindowSource="pi_ai_registry"
        />
      );
      // pi_ai_registry has no warning icon, so no span[title] in the component.
      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan).toBeNull();
    });

    it('renders the registry tooltip with matchedProvider — no title on the value span', () => {
      const { container } = render(
        <TokenUsageDisplay
          inputTokens={10_000}
          outputTokens={0}
          contextWindow={131_072}
          contextWindowSource="pi_ai_registry"
          contextWindowMatchedProvider="deepseek"
        />
      );
      // pi_ai_registry has no warning icon, so no span[title] in the component.
      const valueSpan = container.querySelector('span[title]');
      expect(valueSpan).toBeNull();
    });

    it('renders the openai_compat_default warning icon + actionable tooltip', () => {
      const { getByLabelText } = render(
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
    });

    it('renders the fallback warning icon + actionable tooltip on the fallback path', () => {
      const { getByLabelText } = render(
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

  it('does not put a racing title tooltip on the container or the value cluster', () => {
    const { container } = render(
      <TokenUsageDisplay
        inputTokens={14_000}
        outputTokens={1_000}
        latestInputTokens={14_000}
        contextWindow={272_000}
        contextWindowSource="fallback"
      />,
    );
    // Outer wrapper must have no aggregate title.
    expect(container.firstChild).not.toHaveAttribute('title');
    // The "X/Y" value cluster must have no source title.
    expect(screen.getByText('14K/272K')).not.toHaveAttribute('title');
  });
});
