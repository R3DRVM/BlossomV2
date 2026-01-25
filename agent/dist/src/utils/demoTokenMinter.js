"use strict";
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
exports.mintDemoTokens = mintDemoTokens;
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const accounts_1 = require("viem/accounts");
/**
 * Mints demo tokens (USDC and WETH) to a recipient address
 * Used for testnet faucet functionality
 */
async function mintDemoTokens(recipientAddress) {
    const { ETH_TESTNET_RPC_URL, DEMO_USDC_ADDRESS, DEMO_WETH_ADDRESS, RELAYER_PRIVATE_KEY } = await Promise.resolve().then(() => __importStar(require('../config')));
    if (!RELAYER_PRIVATE_KEY) {
        throw new Error('RELAYER_PRIVATE_KEY not configured');
    }
    if (!DEMO_USDC_ADDRESS || !DEMO_WETH_ADDRESS) {
        throw new Error('Demo token addresses not configured');
    }
    if (!ETH_TESTNET_RPC_URL) {
        throw new Error('ETH_TESTNET_RPC_URL not configured');
    }
    const account = (0, accounts_1.privateKeyToAccount)(RELAYER_PRIVATE_KEY);
    const client = (0, viem_1.createWalletClient)({
        account,
        chain: chains_1.sepolia,
        transport: (0, viem_1.http)(ETH_TESTNET_RPC_URL)
    }).extend(viem_1.publicActions);
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
    // Mint USDC (10,000 with 6 decimals)
    const usdcAmount = BigInt(10000 * 10 ** 6);
    const usdcTxHash = await client.writeContract({
        address: DEMO_USDC_ADDRESS,
        abi: mintAbi,
        functionName: 'mint',
        args: [recipientAddress, usdcAmount]
    });
    // Wait for USDC tx to be mined
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