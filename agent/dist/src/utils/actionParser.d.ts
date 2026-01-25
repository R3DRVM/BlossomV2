/**
 * Action Parser and Validator
 * Parses and validates BlossomAction[] from LLM JSON output
 */
import { BlossomAction, BlossomPortfolioSnapshot, BlossomExecutionRequest } from '../types/blossom';
/**
 * Validate and sanitize actions from LLM output
 */
export declare function validateActions(raw: any): BlossomAction[];
/**
 * Build prompts for Blossom LLM
 */
export declare function buildBlossomPrompts(args: {
    userMessage: string;
    portfolio: BlossomPortfolioSnapshot | null;
    venue: 'hyperliquid' | 'event_demo';
}): Promise<{
    systemPrompt: string;
    userPrompt: string;
    isPredictionMarketQuery: boolean;
}>;
/**
 * Validate execution request from LLM
 */
export declare function validateExecutionRequest(raw: any): BlossomExecutionRequest | null;
/**
 * Build deterministic response for prediction market queries in stub mode
 */
export declare function buildPredictionMarketResponse(userMessage: string, venue: 'hyperliquid' | 'event_demo', accountValueUsd?: number): Promise<{
    assistantMessage: string;
    actions: BlossomAction[];
}>;
//# sourceMappingURL=actionParser.d.ts.map