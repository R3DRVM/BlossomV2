/**
 * EVM RPC Utilities
 * Lightweight JSON-RPC helpers for contract interaction
 */
/**
 * Pad address to 32 bytes (64 hex chars)
 */
export declare function padAddress(address: string): string;
/**
 * Encode function call data
 * @param functionSelector - 4-byte function selector (e.g., "0x7ecebe00")
 * @param params - Array of encoded parameters (without 0x prefix)
 */
export declare function encodeCall(functionSelector: string, ...params: string[]): string;
/**
 * Call eth_getCode
 */
export declare function eth_getCode(rpcUrl: string, address: string): Promise<string>;
/**
 * Call eth_call
 */
export declare function eth_call(rpcUrl: string, to: string, data: string): Promise<string>;
/**
 * Decode boolean from eth_call result
 */
export declare function decodeBool(hex: string): boolean;
/**
 * Decode uint256 from eth_call result
 */
export declare function decodeUint256(hex: string): string;
//# sourceMappingURL=evmRpc.d.ts.map