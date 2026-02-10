export const DEMO_STABLE_INTERNAL_SYMBOL = 'REDACTED';
export const DEMO_STABLE_BRAND_SYMBOL = 'bUSDC';
export const DEMO_STABLE_ALT_SYMBOL = 'blsmUSDC';

export function formatTokenSymbol(symbol?: string | null): string {
  if (!symbol) return '';
  const normalized = String(symbol).toUpperCase();
  if (
    normalized === DEMO_STABLE_INTERNAL_SYMBOL ||
    normalized === DEMO_STABLE_ALT_SYMBOL.toUpperCase() ||
    normalized === 'USDC' ||
    normalized === 'BUSDC'
  ) {
    return DEMO_STABLE_BRAND_SYMBOL;
  }
  return symbol;
}

export function brandStableText(input: string): string {
  // Keep this intentionally conservative: only replace standalone token symbols (word-boundary),
  // so we don't clobber unrelated text.
  return input.replace(/\b(REDACTED|USDC|BUSDC|BLSMUSDC)\b/gi, DEMO_STABLE_BRAND_SYMBOL);
}
