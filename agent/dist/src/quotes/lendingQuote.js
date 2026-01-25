/**
 * Lending Quote Provider
 * Provides routing metadata for lending operations
 * Supports hybrid model: real APR data from DefiLlama + deterministic execution
 */
import { DEMO_LEND_VAULT_ADDRESS, LENDING_EXECUTION_MODE, LENDING_RATE_SOURCE, ETH_TESTNET_CHAIN_ID, } from '../config';
/**
 * Demo lending vault informational APR (5%)
 */
const DEMO_VAULT_APR_BPS = 500;
/**
 * Get lending routing decision with APR data
 * Uses DefiLlama for real rates (when available), falls back to deterministic
 */
export async function getLendingRoutingDecision(request) {
    const warnings = [];
    let apr = DEMO_VAULT_APR_BPS;
    let routingSource = 'deterministic';
    // Try to get APR from DefiLlama if configured
    if (LENDING_RATE_SOURCE === 'defillama') {
        try {
            const { getTopYieldVaults } = await import('./defiLlamaQuote');
            const vaults = await getTopYieldVaults();
            if (vaults.length > 0) {
                // Use highest APY vault
                apr = Math.round(vaults[0].apy * 100); // Convert to bps
                routingSource = 'defillama';
            }
            else {
                warnings.push('DefiLlama vaults not available; using demo rate');
            }
        }
        catch (error) {
            console.warn('[lendingQuote] DefiLlama fetch failed:', error.message);
            warnings.push('DefiLlama fetch failed; using demo rate');
        }
    }
    const vaultAddress = request.vaultAddress || DEMO_LEND_VAULT_ADDRESS || '';
    const isDemo = LENDING_EXECUTION_MODE === 'demo';
    return {
        routingSource,
        apr: (apr / 100).toFixed(2), // Convert bps to percentage
        aprBps: apr,
        protocol: isDemo ? 'DemoLendVault' : 'Aave V3',
        executionVenue: isDemo ? 'Blossom Demo Lending Vault' : 'Aave V3',
        executionNote: isDemo
            ? 'Executed deterministically via demo vault; APR is informational only.'
            : 'Executed via real lending protocol.',
        vault: vaultAddress,
        chain: 'Sepolia',
        chainId: ETH_TESTNET_CHAIN_ID,
        settlementEstimate: '~1 block',
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
/**
 * Attempt to fetch APR from DefiLlama
 * Returns APR as percentage (e.g., 5.0 for 5%)
 */
async function getDefiLlamaApr(assetAddress) {
    // DefiLlama yields endpoint for Sepolia is limited
    // For MVP, we'll return undefined to use deterministic rate
    // In production, this would query DefiLlama's pools API
    // Example endpoint: https://yields.llama.fi/pools
    // But Sepolia testnet doesn't have real yield data
    try {
        // For demo purposes, simulate a slightly different rate
        // In real implementation, fetch from DefiLlama API
        const response = await fetch('https://yields.llama.fi/pools', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            return undefined;
        }
        // DefiLlama returns mainnet data; we can't match Sepolia addresses
        // Return undefined to fall back to deterministic rate
        console.log('[lendingQuote] DefiLlama data fetched but not applicable to Sepolia testnet');
        return undefined;
    }
    catch (error) {
        // Network error or timeout
        return undefined;
    }
}
/**
 * Get informational APR for display (demo vault)
 */
export function getDemoVaultApr() {
    return {
        apr: (DEMO_VAULT_APR_BPS / 100).toFixed(2),
        aprBps: DEMO_VAULT_APR_BPS,
    };
}
//# sourceMappingURL=lendingQuote.js.map