import { createWalletClient, http, publicActions } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
/**
 * Mints demo tokens (REDACTED and WETH) to a recipient address
 * Used for testnet faucet functionality
 */
export async function mintDemoTokens(recipientAddress) {
    const { ETH_TESTNET_RPC_URL, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS, RELAYER_PRIVATE_KEY } = await import('../config');
    if (!RELAYER_PRIVATE_KEY) {
        throw new Error('RELAYER_PRIVATE_KEY not configured');
    }
    if (!DEMO_REDACTED_ADDRESS || !DEMO_WETH_ADDRESS) {
        throw new Error('Demo token addresses not configured');
    }
    if (!ETH_TESTNET_RPC_URL) {
        throw new Error('ETH_TESTNET_RPC_URL not configured');
    }
    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY);
    const client = createWalletClient({
        account,
        chain: sepolia,
        transport: http(ETH_TESTNET_RPC_URL)
    }).extend(publicActions);
    // ERC20 mint function ABI
    const mintAbi = [
        {
            name: 'mint',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: []
        }
    ];
    // Mint REDACTED (10,000 with 6 decimals)
    const usdcAmount = BigInt(10000 * 10 ** 6);
    const usdcTxHash = await client.writeContract({
        address: DEMO_REDACTED_ADDRESS,
        abi: mintAbi,
        functionName: 'mint',
        args: [recipientAddress, usdcAmount]
    });
    // Wait for REDACTED tx to be mined
    await client.waitForTransactionReceipt({ hash: usdcTxHash });
    // Mint WETH (5 with 18 decimals)
    const wethAmount = BigInt(5 * 10 ** 18);
    const wethTxHash = await client.writeContract({
        address: DEMO_WETH_ADDRESS,
        abi: mintAbi,
        functionName: 'mint',
        args: [recipientAddress, wethAmount]
    });
    // Wait for WETH tx to be mined
    await client.waitForTransactionReceipt({ hash: wethTxHash });
    return {
        txHashes: {
            usdc: usdcTxHash,
            weth: wethTxHash
        },
        amounts: {
            usdc: '10000',
            weth: '5'
        }
    };
}
//# sourceMappingURL=demoTokenMinter.js.map