export interface FormatTokensOptions {
  /** Decimal places for the thousands (k) abbreviation. Default 1. */
  decimals?: number;
  /** Uppercase the unit suffix (K instead of k). Default false. */
  upper?: boolean;
}

/**
 * Abbreviate a token count. Millions always use one decimal (both call sites
 * agree); the thousands precision and unit case are configurable so the compact
 * indicator (`14K`) and the breakdown card (`25.9k`) share one implementation.
 */
export function formatTokens(count: number, opts: FormatTokensOptions = {}): string {
  const { decimals = 1, upper = false } = opts;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(decimals)}${upper ? 'K' : 'k'}`;
  return String(count);
}
