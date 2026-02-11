export const TIER1_SUPPORTED_CHAINS = ['ethereum'] as const;
export const TIER1_SUPPORTED_VENUES = ['uniswap_v3', 'aave_v3', 'demo_perp', 'demo_event'] as const;
export const TIER1_SUPPORTED_CATEGORIES = [
  'swap',
  'deposit',
  'event',
  'event_close',
  'perp',
  'perp_close',
  'plan',
  'confirm',
] as const;

type Tier1Chain = (typeof TIER1_SUPPORTED_CHAINS)[number];
type Tier1Category = (typeof TIER1_SUPPORTED_CATEGORIES)[number];

const CHAIN_SET = new Set<string>(TIER1_SUPPORTED_CHAINS);
const CATEGORY_SET = new Set<string>(TIER1_SUPPORTED_CATEGORIES);

export function isTier1RelayedMode(mode: string | undefined | null): boolean {
  return String(mode || '').trim().toLowerCase() === 'tier1_relayed_required';
}

export function isTier1RelayedExecutionSupported(input: {
  chain?: string;
  category?: string;
}): boolean {
  const chain = String(input.chain || '').trim().toLowerCase();
  const category = String(input.category || '').trim().toLowerCase();

  if (!CHAIN_SET.has(chain)) {
    return false;
  }

  if (!category) {
    return true;
  }

  return CATEGORY_SET.has(category);
}

export type { Tier1Chain, Tier1Category };
