/**
 * EVM RPC Utilities
 * Lightweight JSON-RPC helpers for contract interaction
 */
/**
 * Pad address to 32 bytes (64 hex chars)
 */
export function padAddress(address) {
    const addressWithoutPrefix = address.toLowerCase().replace(/^0x/, '');
    return '0x' + addressWithoutPrefix.padStart(64, '0');
}
/**
 * Encode function call data
 * @param functionSelector - 4-byte function selector (e.g., "0x7ecebe00")
 * @param params - Array of encoded parameters (without 0x prefix)
 */
export function encodeCall(functionSelector, ...params) {
    return functionSelector + params.join('');
}
/**
 * Call eth_getCode
 */
export async function eth_getCode(rpcUrl, address) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getCode',
            params: [address.toLowerCase(), 'latest'],
        }),
    });
    const jsonResult = await response.json();
    const result = jsonResult;
    if (result.error) {
        throw new Error(`RPC error: ${result.error.message || 'Unknown error'}`);
    }
    if (!result.result) {
        return '0x';
    }
    return result.result;
}
/**
 * Call eth_call
 */
export async function eth_call(rpcUrl, to, data) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [
                {
                    to: to.toLowerCase(),
                    data: data,
                },
                'latest',
            ],
        }),
    });
    const jsonResult = await response.json();
    const result = jsonResult;
    if (result.error) {
        throw new Error(`RPC error: ${result.error.message || 'Unknown error'}`);
    }
    if (!result.result) {
        return '0x';
    }
    return result.result;
}
/**
 * Decode boolean from eth_call result
 */
export function decodeBool(hex) {
    // Remove 0x prefix and leading zeros, check if last char is odd (1) or even (0)
    const cleaned = hex.replace(/^0x0*/, '');
    if (cleaned === '')
        return false;
    // Check if the value is non-zero
    return BigInt(hex) !== 0n;
}
/**
 * Decode uint256 from eth_call result
 */
export function decodeUint256(hex) {
    if (!hex || hex === '0x' || hex === '0x0') {
        return '0';
    }
    return BigInt(hex).toString();
}
//# sourceMappingURL=evmRpc.js.map