/**
 * ERC20 RPC Helpers
 * Read ERC20 token balance and allowance via JSON-RPC eth_call
 */
/**
 * Get ERC20 token balance for an address
 * @param token Token contract address
 * @param owner Owner address
 * @returns Token balance as bigint
 */
export declare function erc20_balanceOf(token: string, owner: string): Promise<bigint>;
/**
 * Get ERC20 token allowance for a spender
 * @param token Token contract address
 * @param owner Owner address
 * @param spender Spender address
 * @returns Token allowance as bigint
 */
export declare function erc20_allowance(token: string, owner: string, spender: string): Promise<bigint>;
//# sourceMappingURL=erc20Rpc.d.ts.map