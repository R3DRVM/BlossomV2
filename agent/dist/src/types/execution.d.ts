/**
 * Execution Types
 * Types for ETH testnet execution prepare/submit flow
 */
export interface ExecutePrepareRequest {
    draftId: string;
    userAddress: string;
    strategy?: any;
    action?: any;
    authMode?: 'direct' | 'session';
    executionIntent?: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc';
    executionKind?: 'demo_swap' | 'default';
}
export interface ExecutePrepareResponse {
    chainId: number;
    to: string;
    data?: string;
    value: string;
    plan?: {
        user: string;
        nonce: string;
        deadline: string;
        actions: Array<{
            actionType: number;
            adapter: string;
            data: string;
        }>;
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
    call?: {
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
    requirements?: {
        approvals?: Array<{
            token: string;
            spender: string;
            amount: string;
        }>;
    };
    summary: string;
    warnings?: string[];
}
export interface ExecuteSubmitRequest {
    draftId: string;
    txHash: string;
}
export interface ExecuteSubmitResponse {
    ok: true;
}
/**
 * Plan type for execution logging
 */
export interface Plan {
    user: string;
    nonce: string;
    deadline: string;
    actions: Array<{
        actionType: number;
        adapter: string;
        data: string;
    }>;
}
//# sourceMappingURL=execution.d.ts.map