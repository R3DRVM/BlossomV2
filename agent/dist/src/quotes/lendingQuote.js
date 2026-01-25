"use strict";
/**
 * Lending Quote Provider
 * Provides routing metadata for lending operations
 * Supports hybrid model: real APR data from DefiLlama + deterministic execution
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLendingRoutingDecision = getLendingRoutingDecision;
exports.getDemoVaultApr = getDemoVaultApr;
const config_1 = require("../config");
/**
 * Demo lending vault informational APR (5%)
 */
const DEMO_VAULT_APR_BPS = 500;
/**
 * Get lending routing decision with APR data
 * Uses DefiLlama for real rates (when available), falls back to deterministic
 */
async function getLendingRoutingDecision(request) {
    const warnings = [];
    let apr = DEMO_VAULT_APR_BPS;
    let routingSource = 'deterministic';
    // Try to get APR from DefiLlama if configured
    if (config_1.LENDING_RATE_SOURCE === 'defillama') {
        try {
            const { getTopYieldVaults } = await Promise.resolve().then(() => __importStar(require('./defiLlamaQuote')));
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
    const vaultAddress = request.vaultAddress || config_1.DEMO_LEND_VAULT_ADDRESS || '';
    const isDemo = config_1.LENDING_EXECUTION_MODE === 'demo';
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
        chainId: config_1.ETH_TESTNET_CHAIN_ID,
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
function getDemoVaultApr() {
    return {
        apr: (DEMO_VAULT_APR_BPS / 100).toFixed(2),
        aprBps: DEMO_VAULT_APR_BPS,
    };
}
//# sourceMappingURL=lendingQuote.js.map