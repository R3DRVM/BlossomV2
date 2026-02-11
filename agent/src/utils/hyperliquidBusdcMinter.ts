import { createWalletClient, http, publicActions, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  HYPERLIQUID_TESTNET_RPC_URL,
  HYPERLIQUID_BUSDC_ADDRESS,
  HYPERLIQUID_BUSDC_DECIMALS,
  HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY,
} from '../config';

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
  const client = createWalletClient({
    account,
    chain: hyperliquidChain,
    transport: http(HYPERLIQUID_TESTNET_RPC_URL),
  }).extend(publicActions);

  const amountUnits = parseUnits(amount.toString(), HYPERLIQUID_BUSDC_DECIMALS);
  const isNonceError = (err: any) => {
    const message = `${err?.message || err}`.toLowerCase();
    return message.includes('nonce') || message.includes('already known');
  };

  const writeWithNonceRetry = async () => {
    try {
      return await client.writeContract({
        address: HYPERLIQUID_BUSDC_ADDRESS,
        abi: mintAbi,
        functionName: 'mint',
        args: [recipientAddress as `0x${string}`, amountUnits],
      });
    } catch (err: any) {
      if (!isNonceError(err)) throw err;
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
    }
  };

  const txHash = await writeWithNonceRetry();

  await client.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    amount,
    recipient: recipientAddress,
  };
}
