import { createWalletClient, http, publicActions } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Mints demo tokens (bUSDC and WETH) to a recipient address
 * Used for testnet faucet functionality
 */
export async function mintDemoTokens(recipientAddress: string) {
  const {
    ETH_TESTNET_RPC_URL,
    DEMO_BUSDC_ADDRESS,
    DEMO_REDACTED_ADDRESS,
    DEMO_WETH_ADDRESS,
    RELAYER_PRIVATE_KEY
  } = await import('../config');

  if (!RELAYER_PRIVATE_KEY) {
    throw new Error('RELAYER_PRIVATE_KEY not configured');
  }

  const busdcAddress = DEMO_BUSDC_ADDRESS || DEMO_REDACTED_ADDRESS;
  if (!busdcAddress || !DEMO_WETH_ADDRESS) {
    throw new Error('Demo token addresses not configured');
  }

  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

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
  ] as const;

  // Mint bUSDC (10,000 with 6 decimals)
  const usdcAmount = BigInt(10000 * 10**6);
  const usdcTxHash = await writeContractWithNonceRetry(client, {
    address: busdcAddress as `0x${string}`,
    abi: mintAbi,
    functionName: 'mint',
    args: [recipientAddress as `0x${string}`, usdcAmount]
  });

  // Wait for bUSDC tx to be mined
  await client.waitForTransactionReceipt({ hash: usdcTxHash });

  // Mint WETH (5 with 18 decimals)
  const wethAmount = BigInt(5 * 10**18);
  const wethTxHash = await writeContractWithNonceRetry(client, {
    address: DEMO_WETH_ADDRESS as `0x${string}`,
    abi: mintAbi,
    functionName: 'mint',
    args: [recipientAddress as `0x${string}`, wethAmount]
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

/**
 * Mint a custom amount of bUSDC for testnet use.
 * Amount is in whole bUSDC units (6 decimals applied internally).
 */
export async function mintBusdc(recipientAddress: string, amount: number) {
  const {
    ETH_TESTNET_RPC_URL,
    DEMO_BUSDC_ADDRESS,
    DEMO_REDACTED_ADDRESS,
    RELAYER_PRIVATE_KEY
  } = await import('../config');

  const busdcAddress = DEMO_BUSDC_ADDRESS || DEMO_REDACTED_ADDRESS;

  if (!RELAYER_PRIVATE_KEY) {
    throw new Error('RELAYER_PRIVATE_KEY not configured');
  }
  if (!busdcAddress) {
    throw new Error('bUSDC address not configured');
  }
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL)
  }).extend(publicActions);

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
  ] as const;

  const amountUnits = BigInt(Math.floor(amount * 10**6));
  const txHash = await writeContractWithNonceRetry(client, {
    address: busdcAddress as `0x${string}`,
    abi: mintAbi,
    functionName: 'mint',
    args: [recipientAddress as `0x${string}`, amountUnits]
  });

  await client.waitForTransactionReceipt({ hash: txHash });
  return { txHash, amount };
}

async function writeContractWithNonceRetry(
  client: ReturnType<typeof createWalletClient> & ReturnType<typeof publicActions>,
  params: {
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args: readonly unknown[];
  }
): Promise<`0x${string}`> {
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nonce = await client.getTransactionCount({
      address: client.account!.address,
      blockTag: 'pending'
    });
    try {
      return await client.writeContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        nonce,
        chain: client.chain,
        account: client.account!,
      });
    } catch (error: any) {
      const msg = `${error?.shortMessage || error?.message || ''}`.toLowerCase();
      const nonceConflict =
        msg.includes('nonce') || msg.includes('replacement transaction underpriced') || msg.includes('already known');
      lastError = error;
      if (!nonceConflict) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }

  throw lastError;
}
