"use strict";
/**
 * Relayer
 * Sends transactions on behalf of users using session permissions
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
exports.sendRelayedTx = sendRelayedTx;
const config_1 = require("../config");
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
/**
 * Send a relayed transaction using the relayer's private key
 * @param to Contract address
 * @param data Encoded function call data
 * @param value ETH value (default: 0)
 * @returns Transaction hash
 */
async function sendRelayedTx({ to, data, value = '0x0', }) {
    (0, config_1.requireRelayerConfig)();
    if (!config_1.RELAYER_PRIVATE_KEY) {
        throw new Error('RELAYER_PRIVATE_KEY is required for relayed execution');
    }
    if (!config_1.ETH_TESTNET_RPC_URL) {
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
        const account = (0, accounts_1.privateKeyToAccount)(config_1.RELAYER_PRIVATE_KEY);
        const client = (0, viem_1.createWalletClient)({
            account,
            chain: chains_1.sepolia,
            transport: (0, viem_1.http)(config_1.ETH_TESTNET_RPC_URL),
        });
        // Task C: Estimate gas before sending (prevent "gas limit too high" errors)
        const { createPublicClient } = await Promise.resolve().then(() => __importStar(require('viem')));
        const publicClient = createPublicClient({
            chain: chains_1.sepolia,
            transport: (0, viem_1.http)(config_1.ETH_TESTNET_RPC_URL),
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