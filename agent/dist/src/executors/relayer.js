/**
 * Relayer
 * Sends transactions on behalf of users using session permissions
 */
import { RELAYER_PRIVATE_KEY, ETH_TESTNET_RPC_URL, requireRelayerConfig } from '../config';
import { createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
/**
 * Send a relayed transaction using the relayer's private key
 * @param to Contract address
 * @param data Encoded function call data
 * @param value ETH value (default: 0)
 * @returns Transaction hash
 */
export async function sendRelayedTx({ to, data, value = '0x0', }) {
    requireRelayerConfig();
    if (!RELAYER_PRIVATE_KEY) {
        throw new Error('RELAYER_PRIVATE_KEY is required for relayed execution');
    }
    if (!ETH_TESTNET_RPC_URL) {
        throw new Error('ETH_TESTNET_RPC_URL is required for relayed execution');
    }
    // Debug: log parameters
    console.log('[relayer] sendRelayedTx params:', {
        to: to?.slice(0, 10) + '...',
        dataLen: data?.length,
        value,
        valueType: typeof value,
    });
    try {
        // Create wallet client with relayer's account
        const account = privateKeyToAccount(RELAYER_PRIVATE_KEY);
        const client = createWalletClient({
            account,
            chain: sepolia,
            transport: http(ETH_TESTNET_RPC_URL),
        });
        // Task C: Estimate gas before sending (prevent "gas limit too high" errors)
        const { createPublicClient } = await import('viem');
        const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(ETH_TESTNET_RPC_URL),
        });
        let gasLimit;
        try {
            const estimatedGas = await publicClient.estimateGas({
                to: to,
                data: data,
                value: BigInt(value),
                account,
            });
            // Apply 1.2x multiplier and clamp to 12M (safe for Sepolia, well below 16M cap)
            const maxGasLimit = BigInt(12_000_000);
            gasLimit = estimatedGas * BigInt(120) / BigInt(100);
            if (gasLimit > maxGasLimit) {
                gasLimit = maxGasLimit;
            }
            if (process.env.DEBUG_DEMO === 'true') {
                console.log('[relayer] Gas estimation:', {
                    estimated: estimatedGas.toString(),
                    withMultiplier: gasLimit.toString(),
                    clamped: gasLimit === maxGasLimit,
                });
            }
        }
        catch (error) {
            // Estimation failed - this usually means the tx will revert
            console.error('[relayer] Gas estimation failed:', error.message);
            throw new Error(`Gas estimation failed: ${error.message}. This usually means the transaction will revert. Check contract addresses and adapter configuration.`);
        }
        // Check relayer ETH balance before sending
        const relayerBalance = await publicClient.getBalance({
            address: account.address,
        });
        const gasPrice = await publicClient.getGasPrice();
        const estimatedCost = gasLimit * gasPrice;
        const MIN_BUFFER = parseEther('0.002'); // Keep 0.002 ETH buffer
        if (relayerBalance < estimatedCost + MIN_BUFFER) {
            console.error('[relayer] Insufficient ETH balance:', {
                balance: formatEther(relayerBalance),
                needed: formatEther(estimatedCost + MIN_BUFFER),
            });
            throw new Error(`Relayer has insufficient ETH for gas. Balance: ${formatEther(relayerBalance)} ETH, ` +
                `Estimated need: ${formatEther(estimatedCost)} ETH`);
        }
        // Send transaction with estimated gas
        const hash = await client.sendTransaction({
            to: to,
            data: data,
            value: BigInt(value),
            gas: gasLimit,
        });
        console.log('[relayer] Sent relayed transaction:', {
            to,
            hash,
            from: account.address,
        });
        return hash;
    }
    catch (error) {
        console.error('[relayer] Failed to send relayed transaction:', error);
        throw new Error(`Relayed transaction failed: ${error.message || 'Unknown error'}`);
    }
}
//# sourceMappingURL=relayer.js.map