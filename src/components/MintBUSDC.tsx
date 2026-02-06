import { useState } from 'react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';
import { useToast } from './toast/useToast';

interface MintBUSDCProps {
  walletAddress?: string | null;
  disabled?: boolean;
  onMinted?: () => void;
  maxPerDay?: number;
}

export default function MintBUSDC({
  walletAddress,
  disabled,
  onMinted,
  maxPerDay = 1000,
}: MintBUSDCProps) {
  const [amount, setAmount] = useState('1000');
  const [status, setStatus] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const { showToast } = useToast();

  const handleMint = async () => {
    if (!walletAddress) return;
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
        body: JSON.stringify({ userAddress: walletAddress, amount: amountNum }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Mint failed');
      }

      setStatus('success');
      showToast({
        title: 'bUSDC minted!',
        description: `Minted ${amountNum} bUSDC. TX: ${payload.txHash?.slice(0, 10)}...`,
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
