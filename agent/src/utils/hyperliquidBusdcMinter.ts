import { createWalletClient, http, publicActions, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  HYPERLIQUID_TESTNET_RPC_URL,
  HYPERLIQUID_BUSDC_ADDRESS,
  HYPERLIQUID_BUSDC_DECIMALS,
  HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY,
} from '../config';

const FALLBACK_HYPERLIQUID_RPC_URL = 'https://api.hyperliquid-testnet.xyz/evm';

const hyperliquidChain = {
  id: 998,
  name: 'Hyperliquid Testnet',
  network: 'hyperliquid-testnet',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: [HYPERLIQUID_TESTNET_RPC_URL || 'https://api.hyperliquid-testnet.xyz/evm'] },
    public: { http: [HYPERLIQUID_TESTNET_RPC_URL || 'https://api.hyperliquid-testnet.xyz/evm'] },
  },
} as const;

const mintAbi = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export async function mintHyperliquidBusdc(recipientAddress: string, amount: number) {
  if (!HYPERLIQUID_BUSDC_ADDRESS) {
    throw new Error('HYPERLIQUID_BUSDC_ADDRESS not configured');
  }
  if (!HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY) {
    throw new Error('HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY not configured');
  }

  const account = privateKeyToAccount(HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY as `0x${string}`);
  const makeClient = (rpcUrl: string) =>
    createWalletClient({
      account,
      chain: hyperliquidChain,
      transport: http(rpcUrl),
    }).extend(publicActions);

  const primaryRpc = HYPERLIQUID_TESTNET_RPC_URL || FALLBACK_HYPERLIQUID_RPC_URL;
  const primaryClient = makeClient(primaryRpc);
  const fallbackClient = makeClient(FALLBACK_HYPERLIQUID_RPC_URL);
  let client = primaryClient;

  const amountUnits = parseUnits(amount.toString(), HYPERLIQUID_BUSDC_DECIMALS);
  const isRetryableTxError = (err: any) => {
    const message = `${err?.message || err}`.toLowerCase();
    return (
      message.includes('nonce') ||
      message.includes('already known') ||
      message.includes('replacement transaction underpriced') ||
      message.includes('underpriced') ||
      message.includes('internal error') ||
      message.includes('unexpected error (code=10055)')
    );
  };

  const isRateLimitError = (err: any) => {
    const message = `${err?.message || err}`.toLowerCase();
    return (
      message.includes('rate limited') ||
      message.includes('too many evm txs') ||
      message.includes('request exceeds defined limit')
    );
  };

  const writeWithRetries = async () => {
    let lastErr: any = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const pendingNonce = await client.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        return await client.writeContract({
          address: HYPERLIQUID_BUSDC_ADDRESS,
          abi: mintAbi,
          functionName: 'mint',
          args: [recipientAddress as `0x${string}`, amountUnits],
          nonce: pendingNonce,
        });
      } catch (err: any) {
        lastErr = err;
        if (isRateLimitError(err)) {
          client = fallbackClient;
        }
        if (!isRetryableTxError(err)) throw err;
        await new Promise(resolve => setTimeout(resolve, 250 + attempt * 150));
      }
    }
    throw lastErr;
  };

  const txHash = await writeWithRetries();

  await client.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    amount,
    recipient: recipientAddress,
  };
}
