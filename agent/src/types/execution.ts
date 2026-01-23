/**
 * Execution Types
 * Types for ETH testnet execution prepare/submit flow
 */

export interface ExecutePrepareRequest {
  draftId: string;
  userAddress: string;
  strategy?: any; // Strategy object from frontend
  action?: any; // BlossomAction (optional, for future use)
  authMode?: 'direct' | 'session';
  executionIntent?: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc';
  executionKind?: 'demo_swap' | 'default'; // demo_swap triggers PULL+SWAP with demo tokens
}

export interface ExecutePrepareResponse {
  chainId: number;
  to: string; // Contract address (hex string)
  data?: string; // Transaction data (hex string) - optional for now
  value: string; // ETH value in wei (hex string)
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
      EIP712Domain: Array<{ name: string; type: string }>;
      Action: Array<{ name: string; type: string }>;
      Plan: Array<{ name: string; type: string }>;
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
      amount: string; // hex string or decimal string
    }>;
  };
  summary: string; // Human-readable summary
  warnings?: string[]; // Optional warnings
}

export interface ExecuteSubmitRequest {
  draftId: string;
  txHash: string; // Transaction hash (hex string)
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