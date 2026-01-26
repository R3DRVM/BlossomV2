/**
 * Uniswap V3 Quoter
 * Fetches quotes from Uniswap V3 QuoterV2 contract on Sepolia
 */
import { ETH_TESTNET_RPC_URL, UNISWAP_V3_ROUTER_ADDRESS } from '../config';
// Uniswap V3 QuoterV2 address on Sepolia
const UNISWAP_V3_QUOTER_V2_ADDRESS = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
/**
 * Get quote from Uniswap V3 QuoterV2
 * @param tokenIn Token in address
 * @param tokenOut Token out address
 * @param amountIn Amount in (wei, as BigInt string)
 * @param fee Fee tier (500, 3000, 10000)
 * @returns Quote result or null if failed
 */
export async function getUniswapV3Quote(params) {
    const { tokenIn, tokenOut, amountIn, fee = 3000 } = params;
    if (!ETH_TESTNET_RPC_URL) {
        console.warn('[getUniswapV3Quote] ETH_TESTNET_RPC_URL not configured');
        return null;
    }
    try {
        // Encode quoteExactInputSingle call
        // function quoteExactInputSingle(
        //   address tokenIn,
        //   address tokenOut,
        //   uint24 fee,
        //   uint256 amountIn,
        //   uint160 sqrtPriceLimitX96
        // ) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
        const { encodeFunctionData, decodeFunctionResult } = await import('viem');
        const quoterAbi = [
            {
                name: 'quoteExactInputSingle',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'tokenIn', type: 'address' },
                    { name: 'tokenOut', type: 'address' },
                    { name: 'fee', type: 'uint24' },
                    { name: 'amountIn', type: 'uint256' },
                    { name: 'sqrtPriceLimitX96', type: 'uint160' },
                ],
                outputs: [
                    { name: 'amountOut', type: 'uint256' },
                    { name: 'sqrtPriceX96After', type: 'uint160' },
                    { name: 'initializedTicksCrossed', type: 'uint32' },
                    { name: 'gasEstimate', type: 'uint256' },
                ],
            },
        ];
        const callData = encodeFunctionData({
            abi: quoterAbi,
            functionName: 'quoteExactInputSingle',
            args: [
                tokenIn,
                tokenOut,
                fee,
                BigInt(amountIn),
                0n, // sqrtPriceLimitX96 = 0 (no price limit)
            ],
        });
        // Call quoter contract
        const response = await fetch(ETH_TESTNET_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [
                    {
                        to: UNISWAP_V3_QUOTER_V2_ADDRESS,
                        data: callData,
                    },
                    'latest',
                ],
            }),
        });
        const data = await response.json();
        if (data.error) {
            console.warn('[getUniswapV3Quote] RPC error:', data.error);
            return null;
        }
        if (!data.result || data.result === '0x') {
            console.warn('[getUniswapV3Quote] No result from quoter');
            return null;
        }
        // Decode result
        const decoded = decodeFunctionResult({
            abi: quoterAbi,
            functionName: 'quoteExactInputSingle',
            data: data.result,
        });
        return {
            amountOut: decoded[0].toString(),
            sqrtPriceX96After: decoded[1].toString(),
            initializedTicksCrossed: decoded[2].toString(),
            gasEstimate: decoded[3].toString(),
        };
    }
    catch (error) {
        console.warn('[getUniswapV3Quote] Error:', error.message);
        return null;
    }
}
/**
 * Check if Uniswap quoter is available
 */
export function isUniswapQuoterAvailable() {
    return !!ETH_TESTNET_RPC_URL && !!UNISWAP_V3_ROUTER_ADDRESS;
}
//# sourceMappingURL=uniswapQuoter.js.map