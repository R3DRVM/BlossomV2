/**
 * Maps internal/backend errors to user-facing messages.
 * Display only userMessage in UI; log debugMessage when VITE_DEBUG_DIAGNOSTICS=true.
 */

export type ErrorCategory = 'network' | 'execution' | 'venue' | 'session' | 'validation' | 'unknown';

export interface MappedError {
  userMessage: string;
  debugMessage: string;
  category: ErrorCategory;
}

const PATTERNS: { pattern: RegExp | ((s: string) => boolean); userMessage: string; category: ErrorCategory }[] = [
  { pattern: /dFlow|DFLOW|dflow/i, userMessage: 'Execution is temporarily unavailable. Please try again or switch venues.', category: 'venue' },
  { pattern: /RPC error|Invalid params|invalid params/i, userMessage: "We couldn't complete this on testnet. Please refresh and retry.", category: 'execution' },
  { pattern: /session|Session expired|NO_SESSION|INVALID_SESSION/i, userMessage: 'Please enable One-Click Session in the sidebar, or confirm with your wallet.', category: 'session' },
  { pattern: /insufficient|balance|INSUFFICIENT/i, userMessage: "You don't have enough balance for this trade. Try a smaller amount.", category: 'validation' },
  { pattern: /slippage|amountOutMin|SLIPPAGE/i, userMessage: 'Price moved. Please try again.', category: 'execution' },
  { pattern: /network|fetch failed|ECONNREFUSED|timeout/i, userMessage: "We couldn't reach the server. Please check your connection and retry.", category: 'network' },
  { pattern: /adapter|ADAPTER_NOT_ALLOWED|VENUE_NOT_CONFIGURED/i, userMessage: 'DeFi execution is temporarily unavailable. Please try again or switch venues.', category: 'venue' },
  { pattern: /router|Router check/i, userMessage: "We couldn't execute this on testnet. Please refresh and retry.", category: 'execution' },
];

export function mapToUserError(
  raw: string | undefined | null,
  errorCode?: string | null
): MappedError {
  const debugMessage = [raw, errorCode].filter(Boolean).join(' ') || 'Unknown error';
  const s = (raw ?? '').trim().toLowerCase();
  const code = (errorCode ?? '').trim();

  for (const { pattern, userMessage, category } of PATTERNS) {
    const match = typeof pattern === 'function' ? pattern(debugMessage) : pattern.test(debugMessage) || pattern.test(code);
    if (match) return { userMessage, debugMessage, category };
  }

  return {
    userMessage: "Something went wrong. Please try again or refresh the page.",
    debugMessage,
    category: 'unknown',
  };
}

export function getUserMessage(raw: string | undefined | null, errorCode?: string | null): string {
  return mapToUserError(raw, errorCode).userMessage;
}

export function logDebugError(mapped: MappedError): void {
  if (import.meta.env.VITE_DEBUG_DIAGNOSTICS === 'true') {
    console.log('[DEBUG_DIAGNOSTICS]', mapped.category, mapped.debugMessage);
  }
}
