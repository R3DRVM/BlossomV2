/**
 * Jupiter DEX Integration (Solana)
 * Full execution support for swaps on Solana devnet/mainnet via Jupiter.
 *
 * Features:
 * - Price fetching from Jupiter Price API
 * - Quote fetching with routing
 * - Swap transaction building
 * - Transaction signing and execution
 */

import { SolanaClient } from './solanaClient';

// API URLs
const JUPITER_PRICE_API_URL = process.env.JUPITER_PRICE_API_URL || 'https://price.jup.ag/v6/price';
const JUPITER_QUOTE_API_URL = process.env.JUPITER_QUOTE_API_URL || 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API_URL = process.env.JUPITER_SWAP_API_URL || 'https://quote-api.jup.ag/v6/swap';

// Common token mints
export const SOLANA_TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  // Devnet tokens
  USDC_DEVNET: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const;

// Type for supported symbols
export type JupiterSymbol = 'SOL' | 'USDC' | 'USDT' | 'BONK' | 'JTO' | 'WIF';

/**
 * Jupiter quote response
 */
export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
}

/**
 * Jupiter swap transaction response
 */
export interface JupiterSwapTransaction {
  swapTransaction: string; // Base64 encoded versioned transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

/**
 * Swap execution result
 */
export interface JupiterSwapResult {
  ok: boolean;
  signature?: string;
  explorerUrl?: string;
  inputAmount?: string;
  outputAmount?: string;
  priceImpactPct?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Get price from Jupiter Price API
 */
export async function getJupiterPriceUsd(symbol: JupiterSymbol): Promise<number | null> {
  try {
    const res = await fetch(`${JUPITER_PRICE_API_URL}?ids=${symbol}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.data?.[symbol]?.price;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

/**
 * Get prices for multiple tokens
 */
export async function getJupiterPricesUsd(symbols: JupiterSymbol[]): Promise<Record<string, number | null>> {
  try {
    const ids = symbols.join(',');
    const res = await fetch(`${JUPITER_PRICE_API_URL}?ids=${ids}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};
    const data = await res.json();

    const prices: Record<string, number | null> = {};
    for (const symbol of symbols) {
      const price = data?.data?.[symbol]?.price;
      prices[symbol] = typeof price === 'number' ? price : null;
    }
    return prices;
  } catch {
    return {};
  }
}

/**
 * Get quote from Jupiter Quote API
 */
export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
  onlyDirectRoutes?: boolean;
  asLegacyTransaction?: boolean;
}): Promise<JupiterQuote | null> {
  const {
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    swapMode = 'ExactIn',
    onlyDirectRoutes = false,
    asLegacyTransaction = false,
  } = params;

  try {
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: slippageBps.toString(),
      swapMode,
      onlyDirectRoutes: onlyDirectRoutes.toString(),
      asLegacyTransaction: asLegacyTransaction.toString(),
    });

    const url = `${JUPITER_QUOTE_API_URL}?${queryParams}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[jupiter] Quote API error: ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Validate response structure
    if (!data.outAmount || !data.routePlan) {
      console.warn('[jupiter] Invalid quote response structure');
      return null;
    }

    return {
      inputMint: data.inputMint,
      inAmount: data.inAmount,
      outputMint: data.outputMint,
      outAmount: data.outAmount,
      otherAmountThreshold: data.otherAmountThreshold,
      swapMode: data.swapMode,
      slippageBps: data.slippageBps,
      priceImpactPct: data.priceImpactPct || '0',
      routePlan: data.routePlan || [],
      contextSlot: data.contextSlot,
      timeTaken: data.timeTaken,
    };
  } catch (error) {
    console.error('[jupiter] Quote fetch error:', error);
    return null;
  }
}

/**
 * Build swap transaction from quote
 */
export async function buildJupiterSwapTransaction(params: {
  quote: JupiterQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  useSharedAccounts?: boolean;
  feeAccount?: string;
  trackingAccount?: string;
  computeUnitPriceMicroLamports?: number;
  prioritizationFeeLamports?: number;
  asLegacyTransaction?: boolean;
  useTokenLedger?: boolean;
  destinationTokenAccount?: string;
  dynamicComputeUnitLimit?: boolean;
  skipUserAccountsRpcCalls?: boolean;
}): Promise<JupiterSwapTransaction | null> {
  const {
    quote,
    userPublicKey,
    wrapAndUnwrapSol = true,
    useSharedAccounts = true,
    computeUnitPriceMicroLamports,
    prioritizationFeeLamports = 'auto',
    asLegacyTransaction = false,
    dynamicComputeUnitLimit = true,
    skipUserAccountsRpcCalls = false,
  } = params;

  try {
    const body: Record<string, any> = {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol,
      useSharedAccounts,
      asLegacyTransaction,
      dynamicComputeUnitLimit,
      skipUserAccountsRpcCalls,
    };

    if (computeUnitPriceMicroLamports !== undefined) {
      body.computeUnitPriceMicroLamports = computeUnitPriceMicroLamports;
    }
    if (prioritizationFeeLamports !== undefined) {
      body.prioritizationFeeLamports = prioritizationFeeLamports;
    }

    const res = await fetch(JUPITER_SWAP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[jupiter] Swap API error: ${res.status} - ${errorText}`);
      return null;
    }

    const data = await res.json();

    if (!data.swapTransaction) {
      console.warn('[jupiter] No swapTransaction in response');
      return null;
    }

    return {
      swapTransaction: data.swapTransaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
      prioritizationFeeLamports: data.prioritizationFeeLamports,
    };
  } catch (error) {
    console.error('[jupiter] Build swap transaction error:', error);
    return null;
  }
}

/**
 * Execute a Jupiter swap
 * Returns the signed transaction and submits it to the network
 */
export async function executeJupiterSwap(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  userPublicKey: string;
  signTransaction: (tx: Buffer) => Promise<Buffer>;
  slippageBps?: number;
  rpcUrl?: string;
}): Promise<JupiterSwapResult> {
  const {
    inputMint,
    outputMint,
    amount,
    userPublicKey,
    signTransaction,
    slippageBps = 50,
    rpcUrl,
  } = params;

  try {
    // Step 1: Get quote
    const quote = await getJupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    if (!quote) {
      return {
        ok: false,
        error: {
          code: 'QUOTE_FAILED',
          message: 'Failed to get Jupiter quote',
        },
      };
    }

    // Step 2: Build swap transaction
    const swapTx = await buildJupiterSwapTransaction({
      quote,
      userPublicKey,
    });

    if (!swapTx) {
      return {
        ok: false,
        error: {
          code: 'BUILD_TX_FAILED',
          message: 'Failed to build swap transaction',
        },
      };
    }

    // Step 3: Deserialize, sign, and serialize the transaction
    const txBuffer = Buffer.from(swapTx.swapTransaction, 'base64');
    const signedTxBuffer = await signTransaction(txBuffer);
    const signedTxBase64 = signedTxBuffer.toString('base64');

    // Step 4: Send and confirm transaction
    const client = new SolanaClient({ rpcUrl });
    const signature = await client.sendTransaction(signedTxBase64);

    // Step 5: Wait for confirmation
    const result = await client.confirmTransaction(signature, 'confirmed', 60000);

    // Determine network for explorer URL
    const isDevnet = (rpcUrl || '').includes('devnet');
    const explorerUrl = isDevnet
      ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
      : `https://explorer.solana.com/tx/${signature}`;

    return {
      ok: true,
      signature,
      explorerUrl,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
    };
  } catch (error: any) {
    console.error('[jupiter] Swap execution error:', error);
    return {
      ok: false,
      error: {
        code: 'EXECUTION_FAILED',
        message: error.message || 'Swap execution failed',
      },
    };
  }
}

/**
 * Get human-readable swap quote summary
 */
export function formatQuoteSummary(quote: JupiterQuote, inputDecimals: number = 9, outputDecimals: number = 6): string {
  const inAmount = Number(quote.inAmount) / Math.pow(10, inputDecimals);
  const outAmount = Number(quote.outAmount) / Math.pow(10, outputDecimals);
  const routes = quote.routePlan.map(r => r.swapInfo.label).join(' -> ');

  return `${inAmount.toFixed(4)} -> ${outAmount.toFixed(4)} via ${routes} (impact: ${quote.priceImpactPct}%)`;
}

/**
 * Resolve token symbol to mint address
 */
export function resolveTokenMint(symbolOrMint: string, isDevnet: boolean = false): string {
  const upper = symbolOrMint.toUpperCase();

  // Special handling for devnet USDC
  if (upper === 'USDC' && isDevnet) {
    return SOLANA_TOKEN_MINTS.USDC_DEVNET;
  }

  // Check known mints
  if (upper in SOLANA_TOKEN_MINTS) {
    return SOLANA_TOKEN_MINTS[upper as keyof typeof SOLANA_TOKEN_MINTS];
  }

  // If it looks like a mint address, return as-is
  if (symbolOrMint.length >= 32) {
    return symbolOrMint;
  }

  // Default to SOL
  return SOLANA_TOKEN_MINTS.SOL;
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(params: {
  walletAddress: string;
  tokenMint: string;
  rpcUrl?: string;
}): Promise<{ balance: string; uiAmount: number; decimals: number } | null> {
  const { walletAddress, tokenMint, rpcUrl } = params;
  const client = new SolanaClient({ rpcUrl });

  try {
    // For native SOL
    if (tokenMint === SOLANA_TOKEN_MINTS.SOL) {
      const result = await client.getBalance(walletAddress);
      return {
        balance: result.lamports.toString(),
        uiAmount: result.sol,
        decimals: 9,
      };
    }

    // For SPL tokens, we need to find the associated token account
    // This requires the SPL Token program, which we'll approximate
    // In production, use @solana/spl-token
    const tokenAccounts = await client.rpcCall<{
      value: Array<{
        pubkey: string;
        account: {
          data: {
            parsed: {
              info: {
                tokenAmount: {
                  amount: string;
                  uiAmount: number;
                  decimals: number;
                };
              };
            };
          };
        };
      }>;
    }>('getTokenAccountsByOwner', [
      walletAddress,
      { mint: tokenMint },
      { encoding: 'jsonParsed' },
    ]);

    if (tokenAccounts.value.length === 0) {
      return { balance: '0', uiAmount: 0, decimals: 6 };
    }

    const tokenAmount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
    return {
      balance: tokenAmount.amount,
      uiAmount: tokenAmount.uiAmount,
      decimals: tokenAmount.decimals,
    };
  } catch (error) {
    console.error('[jupiter] Get token balance error:', error);
    return null;
  }
}

export default {
  getJupiterPriceUsd,
  getJupiterPricesUsd,
  getJupiterQuote,
  buildJupiterSwapTransaction,
  executeJupiterSwap,
  formatQuoteSummary,
  resolveTokenMint,
  getTokenBalance,
  SOLANA_TOKEN_MINTS,
};
