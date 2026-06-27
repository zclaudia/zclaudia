import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextUsageCard, formatTokenCount } from './ContextUsageCard';
import type { ContextUsagePayload } from '@zclaudia/shared';

function makePayload(overrides?: Partial<ContextUsagePayload>): ContextUsagePayload {
  return {
    model: 'claude-sonnet-4-6',
    contextWindow: 200_000,
    contextWindowSource: 'pi_ai_registry',
    usedTokens: 25_900,
    usedTokensFromUsage: true,
    breakdown: {
      systemPrompt: { tokens: 2_900, estimated: true },
      tools: { tokens: 5_600, estimated: true, count: 12 },
      skills: { tokens: 8_800, estimated: true },
      messages: { tokens: 8_600, estimated: true, clamped: false },
      freeSpace: { tokens: 174_100, percent: 87.1 },
    },
    capturedAt: 1_770_000_000_000,
    ...overrides,
  };
}

describe('formatTokenCount', () => {
  it('abbreviates with k/M', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(25_900)).toBe('25.9k');
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
  });
});

describe('ContextUsageCard', () => {
  it('renders header with used/total and percentage', () => {
    render(<ContextUsageCard usage={makePayload()} />);
    expect(screen.getByText('Context window')).toBeInTheDocument();
    expect(screen.getByText('25.9k / 200.0k (13.0%)')).toBeInTheDocument();
  });

  it('renders one row per category with ~ on estimated values', () => {
    render(<ContextUsageCard usage={makePayload()} />);
    expect(screen.getByText('System prompt')).toBeInTheDocument();
    expect(screen.getByText('Tools (12)')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Free space')).toBeInTheDocument();
    expect(screen.getByText('~2.9k')).toBeInTheDocument();   // estimated → ~ prefix
    expect(screen.getByText('174.1k')).toBeInTheDocument();  // free space → no prefix
  });

  it('drops the translucent inline chrome in the bare variant (opaque host owns the surface)', () => {
    const { rerender } = render(<ContextUsageCard usage={makePayload()} />);
    // Inline default keeps its translucent bordered card chrome.
    expect(screen.getByTestId('context-usage-card').className).toContain('bg-secondary/30');
    // Bare variant drops the translucent bg / border / margin so it can sit on
    // an opaque popover surface without bleed-through or a double border.
    rerender(<ContextUsageCard usage={makePayload()} bare />);
    const bare = screen.getByTestId('context-usage-card').className;
    expect(bare).not.toContain('bg-secondary/30');
    expect(bare).not.toContain('border');
  });

  it('shows the estimation footnote and context-window source', () => {
    render(<ContextUsageCard usage={makePayload()} />);
    expect(screen.getByText(/chars\/4 estimates/i)).toBeInTheDocument();
    expect(screen.getByText(/from model registry/i)).toBeInTheDocument();
  });

  it('flags clamped residual and estimate-only totals', () => {
    render(
      <ContextUsageCard
        usage={makePayload({
          usedTokensFromUsage: false,
          breakdown: {
            ...makePayload().breakdown,
            messages: { tokens: 0, estimated: true, clamped: true },
          },
        })}
      />,
    );
    expect(screen.getByText(/estimates exceeded real usage/i)).toBeInTheDocument();
    expect(screen.getByText(/no completed run yet/i)).toBeInTheDocument();
  });

  it('shows an actionable hint when the context window is a fallback estimate', () => {
    render(<ContextUsageCard usage={makePayload({ contextWindowSource: 'fallback' })} />);
    expect(screen.getByText(/declare it on your LLM profile/i)).toBeInTheDocument();
  });

  it('shows an actionable hint for the openai-compat default', () => {
    render(<ContextUsageCard usage={makePayload({ contextWindowSource: 'openai_compat_default' })} />);
    expect(screen.getByText(/openai-compat 128,000 default/i)).toBeInTheDocument();
  });

  it('shows no actionable hint for a known source', () => {
    render(<ContextUsageCard usage={makePayload({ contextWindowSource: 'pi_ai_registry' })} />);
    expect(screen.queryByText(/declare .*LLM profile/i)).toBeNull();
  });
});
