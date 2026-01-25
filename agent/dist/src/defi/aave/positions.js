"use strict";
/**
 * Aave Position Reader
 * Reads aToken balances and position data from chain
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
exports.readAavePositions = readAavePositions;
exports.readAavePosition = readAavePosition;
const config_1 = require("../../config");
const market_1 = require("./market");
const erc20Rpc_1 = require("../../executors/erc20Rpc");
/**
 * Read all Aave positions for a user
 */
async function readAavePositions(userAddress) {
    if (!config_1.ETH_TESTNET_RPC_URL) {
        console.warn('[aave/positions] ETH_TESTNET_RPC_URL not configured');
        return [];
    }
    try {
        const marketConfig = await (0, market_1.getAaveMarketConfig)();
        const supportedAssets = await (0, market_1.getSupportedAssets)();
        const positions = [];
        for (const asset of supportedAssets) {
            try {
                // Fetch aToken address if not already set
                let aTokenAddress = asset.aTokenAddress;
                if (aTokenAddress === '0x0000000000000000000000000000000000000000') {
                    const fetched = await Promise.resolve().then(() => __importStar(require('./market'))).then(m => m.getATokenAddress(asset.address));
                    if (fetched) {
                        aTokenAddress = fetched;
                    }
                    else {
                        continue; // Skip if we can't get aToken address
                    }
                }
                // Read aToken balance
                const balance = await (0, erc20Rpc_1.erc20_balanceOf)(aTokenAddress, userAddress);
                if (balance > 0n) {
                    // Format balance based on decimals
                    const decimals = asset.decimals;
                    const divisor = BigInt(10 ** decimals);
                    const whole = balance / divisor;
                    const fraction = balance % divisor;
                    const balanceFormatted = `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/\.?0+$/, '')}`;
                    positions.push({
                        asset: asset.symbol,
                        assetAddress: asset.address,
                        aTokenAddress,
                        balance,
                        balanceFormatted,
                        // Best-effort USD value (assume 1:1 for USDC)
                        underlyingValueUsd: asset.symbol === 'USDC' ? parseFloat(balanceFormatted) : undefined,
                        // APY would require fetching from PoolDataProvider.getReserveData
                        // For now, we'll leave it undefined and let the frontend handle it
                    });
                }
            }
            catch (error) {
                console.warn(`[aave/positions] Failed to read position for ${asset.symbol}:`, error.message);
                // Continue with other assets
            }
        }
        return positions;
    }
    catch (error) {
        console.error('[aave/positions] Failed to read Aave positions:', error.message);
        return [];
    }
}
/**
 * Read a single Aave position for a specific asset
 */
async function readAavePosition(userAddress, assetSymbol) {
    const positions = await readAavePositions(userAddress);
    return positions.find(p => p.asset === assetSymbol) || null;
}
//# sourceMappingURL=positions.js.map