/**
 * Aave v3 Market Configuration
 * Single source of truth for Aave v3 testnet market data
 */
import { ETH_TESTNET_CHAIN_ID, ETH_TESTNET_RPC_URL } from '../../config';
/**
 * Aave v3 Sepolia Market Configuration
 * Official addresses from: https://docs.aave.com/developers/deployed-contracts/v3-testnet-addresses
 */
const AAVE_V3_SEPOLIA_CONFIG = {
    chainId: 11155111, // Sepolia
    poolAddress: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    poolAddressesProvider: '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A',
    poolDataProvider: '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31',
    supportedAssets: [
        // USDC on Sepolia (testnet token)
        // Note: aToken addresses can be fetched dynamically via PoolDataProvider
        // For now, we'll use a known address or fetch it on-demand
        // The actual USDC address on Sepolia may vary - this will be overridden by AAVE_USDC_ADDRESS if set
        {
            symbol: 'USDC',
            address: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', // Sepolia USDC testnet token (fallback)
            aTokenAddress: '0x0000000000000000000000000000000000000000', // Will be fetched dynamically
            decimals: 6,
        },
    ],
};
/**
 * Get Aave market configuration for the current chain
 */
export async function getAaveMarketConfig() {
    const chainId = ETH_TESTNET_CHAIN_ID || 11155111;
    if (chainId === 11155111) {
        // Sepolia - use official Aave v3 addresses
        return AAVE_V3_SEPOLIA_CONFIG;
    }
    throw new Error(`Aave v3 market not configured for chainId ${chainId}`);
}
/**
 * Fetch aToken address for an asset using PoolDataProvider
 */
export async function getATokenAddress(assetAddress) {
    try {
        const { createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');
        if (!ETH_TESTNET_RPC_URL) {
            console.warn('[aave/market] ETH_TESTNET_RPC_URL not configured, cannot fetch aToken address');
            return null;
        }
        const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(ETH_TESTNET_RPC_URL),
        });
        const config = await getAaveMarketConfig();
        // PoolDataProvider.getReserveTokensAddresses(address asset) returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)
        const abi = [
            {
                name: 'getReserveTokensAddresses',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'asset', type: 'address' }],
                outputs: [
                    { name: 'aTokenAddress', type: 'address' },
                    { name: 'stableDebtTokenAddress', type: 'address' },
                    { name: 'variableDebtTokenAddress', type: 'address' },
                ],
            },
        ];
        const result = await publicClient.readContract({
            address: config.poolDataProvider,
            abi,
            functionName: 'getReserveTokensAddresses',
            args: [assetAddress],
        });
        return result[0]; // aToken address
    }
    catch (error) {
        console.warn(`[aave/market] Failed to fetch aToken address for ${assetAddress}:`, error.message);
        return null;
    }
}
/**
 * Get supported asset by symbol
 */
export async function getSupportedAsset(symbol) {
    const config = await getAaveMarketConfig();
    const asset = config.supportedAssets.find(a => a.symbol === symbol);
    if (!asset) {
        return null;
    }
    // If aToken address is not set, try to fetch it
    if (asset.aTokenAddress === '0x0000000000000000000000000000000000000000') {
        const aTokenAddress = await getATokenAddress(asset.address);
        if (aTokenAddress) {
            asset.aTokenAddress = aTokenAddress;
        }
    }
    return asset;
}
/**
 * Get all supported assets with aToken addresses
 */
export async function getSupportedAssets() {
    const config = await getAaveMarketConfig();
    // Fetch aToken addresses for assets that don't have them
    const assetsWithATokens = await Promise.all(config.supportedAssets.map(async (asset) => {
        if (asset.aTokenAddress === '0x0000000000000000000000000000000000000000') {
            const aTokenAddress = await getATokenAddress(asset.address);
            if (aTokenAddress) {
                return { ...asset, aTokenAddress };
            }
        }
        return asset;
    }));
    return assetsWithATokens;
}
//# sourceMappingURL=market.js.map