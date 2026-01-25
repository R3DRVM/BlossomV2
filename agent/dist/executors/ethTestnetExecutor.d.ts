/**
 * ETH Testnet Executor
 * Prepares execution plans and EIP-712 typed data for signing
 */
import { BlossomExecutionRequest } from '../types/blossom';
export interface PrepareEthTestnetExecutionArgs {
    draftId: string;
    userAddress: string;
    strategy?: any;
    authMode?: 'direct' | 'session';
    executionIntent?: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc';
    executionRequest?: BlossomExecutionRequest;
    executionKind?: 'demo_swap' | 'lend_supply' | 'perp' | 'event' | 'default';
}
export interface ApprovalRequirement {
    token: string;
    spender: string;
    amount: string;
}
export interface PrepareEthTestnetExecutionResult {
    chainId: number;
    to: string;
    value: string;
    plan: {
        user: string;
        nonce: string;
        deadline: string;
        actions: Array<{
            actionType: number;
            adapter: string;
            data: string;
        }>;
    };
    requirements?: {
        approvals?: ApprovalRequirement[];
    };
    typedData?: {
        domain: {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: string;
        };
        types: {
            EIP712Domain: Array<{
                name: string;
                type: string;
            }>;
            Action: Array<{
                name: string;
                type: string;
            }>;
            Plan: Array<{
                name: string;
                type: string;
            }>;
        };
        primaryType: string;
        message: {
            user: string;
            nonce: string;
            deadline: string;
            actions: Array<{
                actionType: number;
                adapter: string;
                data: string;
            }>;
        };
    };
    call: {
        method: 'executeBySender';
        args: {
            plan: {
                user: string;
                nonce: string;
                deadline: string;
                actions: Array<{
                    actionType: number;
                    adapter: string;
                    data: string;
                }>;
            };
        };
    };
    summary: string;
    warnings?: string[];
    routing?: {
        venue: string;
        chain: string;
        feeTier?: number;
        expectedOut?: string;
        expectedOutRaw?: string;
        minOut?: string;
        minOutRaw?: string;
        slippageBps?: number;
        settlementEstimate: string;
        routingSource?: '1inch' | 'deterministic' | 'defillama' | 'dflow' | 'uniswap';
        routeSummary?: string;
        protocols?: string[];
        estimatedGas?: string;
        executionVenue?: string;
        executionNote?: string;
        warnings?: string[];
        apr?: string;
        aprBps?: number;
        vault?: string;
        actionType?: 'swap' | 'lend_supply';
        venueType?: number;
    };
    netExposure?: string;
}
/**
 * Convert executionRequest to executionIntent and params
 */
export declare function executionRequestToIntent(executionRequest: BlossomExecutionRequest): {
    executionIntent: 'swap_usdc_weth' | 'swap_weth_usdc';
    amountIn: bigint;
    tokenIn: string;
    tokenOut: string;
    fundingPolicy: 'auto' | 'require_tokenIn';
};
/**
 * Prepare ETH testnet execution plan and EIP-712 typed data
 */
export declare function prepareEthTestnetExecution(args: PrepareEthTestnetExecutionArgs): Promise<PrepareEthTestnetExecutionResult>;
//# sourceMappingURL=ethTestnetExecutor.d.ts.map