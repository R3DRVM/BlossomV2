import { useEffect, useMemo, useState } from 'react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';
import { useToast } from './toast/useToast';

type MintChain = 'ethereum' | 'solana' | 'hyperliquid';

interface MintBUSDCProps {
  walletAddress?: string | null;
  solanaAddress?: string | null;
  defaultChain?: MintChain;
  disabled?: boolean;
  onMinted?: () => void;
  maxPerDay?: number;
}

export default function MintBUSDC({
  walletAddress,
  solanaAddress,
  defaultChain = 'ethereum',
  disabled,
  onMinted,
  maxPerDay = 1000,
}: MintBUSDCProps) {
  const [amount, setAmount] = useState('1000');
  const [status, setStatus] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const [chain, setChain] = useState<MintChain>(defaultChain);
  const { showToast } = useToast();

  const enabledChains = useMemo(() => {
    const next: MintChain[] = [];
    if (walletAddress) {
      next.push('ethereum', 'hyperliquid');
    }
    if (solanaAddress) {
      next.push('solana');
    }
    return next;
  }, [walletAddress, solanaAddress]);

  const chainOptions = [
    { value: 'ethereum' as const, label: 'ETH', enabled: enabledChains.includes('ethereum') },
    { value: 'solana' as const, label: 'SOL', enabled: enabledChains.includes('solana') },
    { value: 'hyperliquid' as const, label: 'HL', enabled: enabledChains.includes('hyperliquid') },
  ];
  const showChainSelect = enabledChains.length > 1;

  // Ensure selected chain stays valid when wallet connections change
  useEffect(() => {
    if (!enabledChains.includes(chain) && enabledChains.length > 0) {
      setChain(enabledChains[0]);
    }
  }, [chain, enabledChains]);

  const handleMint = async () => {
    const targetAddress = chain === 'solana' ? solanaAddress : walletAddress;
    if (!targetAddress) {
      showToast({
        title: 'Wallet not connected',
        description: chain === 'solana' ? 'Connect a Solana wallet first.' : 'Connect an Ethereum wallet first.',
        variant: 'default',
      });
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > maxPerDay) {
      showToast({
        title: 'Invalid amount',
        description: `Enter an amount between 1 and ${maxPerDay}.`,
        variant: 'default',
      });
      return;
    }

    setStatus('minting');
    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountNum,
          chain,
          userAddress: chain === 'solana' ? undefined : targetAddress,
          solanaAddress: chain === 'solana' ? targetAddress : undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Mint failed');
      }

      const txLabel = payload.txHash
        ? `TX: ${payload.txHash.slice(0, 10)}...`
        : payload.signature
          ? `SIG: ${payload.signature.slice(0, 10)}...`
          : '';

      setStatus('success');
      showToast({
        title: 'bUSDC minted!',
        description: `Minted ${amountNum} bUSDC on ${chain.toUpperCase()}. ${txLabel}`,
        variant: 'success',
      });
      onMinted?.();
      setTimeout(() => setStatus('idle'), 2500);
    } catch (error: any) {
      setStatus('error');
      showToast({
        title: 'Mint failed',
        description: error.message || 'Unable to mint bUSDC',
        variant: 'default',
      });
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const isDisabled = disabled || status === 'minting' || status === 'success';

  return (
    <span className="flex items-center gap-1.5 text-[9px] text-slate-500">
      <span>Need bUSDC?</span>
      {showChainSelect && (
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value as MintChain)}
          className="px-1 py-0.5 rounded border border-slate-200 text-[9px] text-slate-600 bg-white"
          aria-label="Mint chain"
        >
          {chainOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={!option.enabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-14 px-1 py-0.5 rounded border border-slate-200 text-[9px] text-slate-600 bg-white"
        aria-label="Mint amount"
      />
      <button
        onClick={isDisabled ? undefined : handleMint}
        disabled={isDisabled}
        className={`font-medium ${
          isDisabled
            ? 'text-slate-400 cursor-not-allowed'
            : status === 'error'
            ? 'text-rose-500'
            : 'text-pink-600 hover:text-pink-700 underline'
        }`}
      >
        {status === 'minting' ? 'Minting...' : status === 'success' ? 'Sent!' : 'Mint'}
      </button>
    </span>
  );
}
