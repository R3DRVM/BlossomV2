export const DEMO_STABLE_INTERNAL_SYMBOL = 'REDACTED';
export const DEMO_STABLE_BRAND_SYMBOL = 'bUSDC';
export const DEMO_STABLE_ALT_SYMBOL = 'blsmUSDC';

export function formatTokenSymbol(symbol?: string | null): string {
  if (!symbol) return '';
  const normalized = String(symbol).toUpperCase();
  if (normalized === DEMO_STABLE_INTERNAL_SYMBOL || normalized === DEMO_STABLE_ALT_SYMBOL.toUpperCase()) {
    return DEMO_STABLE_BRAND_SYMBOL;
  }
  return symbol;
}

export function brandStableText(input: string): string {
  return input.replace(/\bREDACTED\b/g, DEMO_STABLE_BRAND_SYMBOL);
}
