/**
 * Intent Runner Orchestrator
 *
 * Transforms user-style prompts into executed transactions:
 * 1. Accept raw intent_text (e.g., "long btc 20x", "swap 5000 usdc to weth")
 * 2. Create ledger intent row (status=queued)
 * 3. Plan: Parse intent, detect kind, extract parameters
 * 4. Route: Map to implemented venues or fail with clear error
 * 5. Execute: Run transaction via appropriate chain executor
 * 6. Confirm: Wait for confirmation and update ledger
 *
 * This orchestrator is honest about what's implemented vs. not.
 *
 * Task 3 Enhancements:
 * - Advanced intent parsing (DCA, leverage, yield optimization, multi-step)
 * - Market data validation before execution
 * - Retry logic with exponential backoff
 * - Rate limiting for external API calls
 */
type IntentKind = 'perp' | 'perp_create' | 'deposit' | 'swap' | 'bridge' | 'event' | 'unknown';
type IntentFailureStage = 'plan' | 'route' | 'execute' | 'confirm' | 'quote';
export type ChainTarget = 'ethereum' | 'solana' | 'both';
export interface ParsedIntent {
    kind: IntentKind;
    action: string;
    amount?: string;
    amountUnit?: string;
    targetAsset?: string;
    leverage?: number;
    sourceChain?: string;
    destChain?: string;
    venue?: string;
    rawParams: Record<string, any>;
}
export interface RouteDecision {
    chain: 'ethereum' | 'solana';
    network: 'sepolia' | 'devnet';
    venue: string;
    adapter?: string;
    executionType: 'real' | 'proof_only';
    warnings?: string[];
}
export interface IntentExecutionResult {
    ok: boolean;
    intentId: string;
    status: string;
    executionId?: string;
    txHash?: string;
    explorerUrl?: string;
    error?: {
        stage: IntentFailureStage;
        code: string;
        message: string;
    };
    metadata?: Record<string, any>;
}
/**
 * Parse a natural language intent into structured format
 *
 * Task 3 Enhancement: Now supports advanced intent parsing for:
 * - DCA (Dollar Cost Averaging): "DCA $1000 into ETH over 5 days"
 * - Leverage positions: "Open 10x long on BTC with $500"
 * - Yield optimization: "Find best yield for $10k USDC"
 * - Multi-step strategies: "Swap half to ETH, deposit rest to Aave"
 *
 * Enhanced with:
 * - Typo correction for asset names
 * - Multiple number formats ($1k, 1,000, etc.)
 * - Natural language variations
 * - Graceful fallback for ambiguous intents
 */
export declare function parseIntent(intentText: string): ParsedIntent;
/**
 * Infer chain from asset symbol
 * Returns undefined if asset is multi-chain (e.g., USDC) or unknown
 */
export declare function inferChainFromAsset(asset: string): string | undefined;
/**
 * Determine execution route for a parsed intent
 */
export declare function routeIntent(parsed: ParsedIntent, preferredChain?: ChainTarget): RouteDecision | {
    error: {
        stage: IntentFailureStage;
        code: string;
        message: string;
    };
};
/**
 * Run a single intent through the full pipeline
 *
 * Options:
 * - chain: Target chain (ethereum, solana, both)
 * - planOnly: Stop after routing, return plan without executing (for confirm mode)
 * - intentId: Execute a previously planned intent (skip parse/route)
 */
export declare function runIntent(intentText: string, options?: {
    chain?: ChainTarget;
    planOnly?: boolean;
    intentId?: string;
    dryRun?: boolean;
    metadata?: Record<string, any>;
    sessionId?: string;
    skipPathValidation?: boolean;
    confirmedIntentId?: string;
}): Promise<IntentExecutionResult>;
/**
 * Execute a previously planned intent by ID
 * Used for confirm-mode flow where user reviews plan first
 */
export declare function executeIntentById(intentId: string): Promise<IntentExecutionResult>;
/**
 * Run multiple intents in batch
 */
export declare function runIntentBatch(intents: string[], options?: {
    chain?: ChainTarget;
    dryRun?: boolean;
    parallel?: boolean;
}): Promise<IntentExecutionResult[]>;
/**
 * Record a failed intent for tracking purposes
 * This ensures ALL attempts (even validation failures) appear in stats
 */
export declare function recordFailedIntent(params: {
    intentText: string;
    failureStage: IntentFailureStage;
    errorCode: string;
    errorMessage: string;
    metadata?: Record<string, any>;
}): Promise<IntentExecutionResult>;
export {};
//# sourceMappingURL=intentRunner.d.ts.map