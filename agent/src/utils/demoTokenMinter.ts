import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getSettlementChainRuntimeConfig, resolveExecutionSettlementChain } from '../config/settlementChains';

/**
 * Mints demo tokens (bUSDC and WETH) to a recipient address
 * Used for testnet faucet functionality
 */
export async function mintDemoTokens(recipientAddress: string) {
  const settlementChain = resolveExecutionSettlementChain(process.env.DEMO_FAUCET_CHAIN || 'sepolia');
  const chainConfig = getSettlementChainRuntimeConfig(settlementChain);

  if (!chainConfig.relayerPrivateKey) {
    throw new Error('RELAYER_PRIVATE_KEY not configured');
  }

  const busdcAddress = chainConfig.stableTokenAddress;
  if (!busdcAddress || !chainConfig.wethTokenAddress) {
    throw new Error('Demo token addresses not configured');
  }

  if (!chainConfig.rpcUrl) {
    throw new Error(`${chainConfig.label} RPC not configured`);
  }

  const account = privateKeyToAccount(chainConfig.relayerPrivateKey as `0x${string}`);

  const client = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl)
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
    address: busdcAddress,
    abi: mintAbi,
    functionName: 'mint',
    args: [recipientAddress as `0x${string}`, usdcAmount]
  });

  // Wait for bUSDC tx to be mined
  await client.waitForTransactionReceipt({ hash: usdcTxHash });

  // Mint WETH (5 with 18 decimals)
  const wethAmount = BigInt(5 * 10**18);
  const wethTxHash = await writeContractWithNonceRetry(client, {
    address: chainConfig.wethTokenAddress,
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
export async function mintBusdc(
  recipientAddress: string,
  amount: number,
  options?: { waitForReceipt?: boolean; receiptTimeoutMs?: number; chain?: string }
) {
  const settlementChain = resolveExecutionSettlementChain(options?.chain);
  const chainConfig = getSettlementChainRuntimeConfig(settlementChain);
  const busdcAddress = chainConfig.stableTokenAddress;

  if (!chainConfig.relayerPrivateKey) {
    throw new Error('RELAYER_PRIVATE_KEY not configured');
  }
  if (!busdcAddress) {
    throw new Error(`bUSDC address not configured for ${chainConfig.label}`);
  }
  if (!chainConfig.rpcUrl) {
    throw new Error(`${chainConfig.label} RPC not configured`);
  }

  const account = privateKeyToAccount(chainConfig.relayerPrivateKey as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl)
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
    address: busdcAddress,
    abi: mintAbi,
    functionName: 'mint',
    args: [recipientAddress as `0x${string}`, amountUnits]
  });

  const shouldWaitForReceipt = options?.waitForReceipt !== false;
  if (shouldWaitForReceipt) {
    await client.waitForTransactionReceipt({
      hash: txHash,
      ...(options?.receiptTimeoutMs && Number.isFinite(options.receiptTimeoutMs)
        ? { timeout: options.receiptTimeoutMs }
        : {}),
    });
  }
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
      const msg = `${error?.shortMessage || ''} ${error?.message || ''} ${error?.details || ''} ${error?.cause?.message || ''}`.toLowerCase();
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
