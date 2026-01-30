/**
 * Execution Blocker
 *
 * Shows blocking CTAs when execution cannot proceed due to:
 * - Wallet not connected
 * - Wrong chain (not Sepolia)
 * - Insufficient gas
 * - Insufficient balance
 */

import { useState } from 'react';
import { Wallet, AlertTriangle, Fuel, Coins, ExternalLink, Loader2 } from 'lucide-react';
import {
  ExecutionError,
  ERROR_MESSAGES,
  FAUCET_URLS,
  switchToSepolia,
} from '../lib/executionGuard';
import { useConnectModal } from '@rainbow-me/rainbowkit';

interface ExecutionBlockerProps {
  error: ExecutionError;
  onRetry?: () => void;
  className?: string;
}

export default function ExecutionBlocker({ error, onRetry, className = '' }: ExecutionBlockerProps) {
  const [isSwitching, setIsSwitching] = useState(false);
  const { openConnectModal } = useConnectModal();
  const errorInfo = ERROR_MESSAGES[error];

  const handleSwitchChain = async () => {
    setIsSwitching(true);
    const success = await switchToSepolia();
    setIsSwitching(false);
    if (success && onRetry) {
      onRetry();
    }
  };

  const getIcon = () => {
    switch (error) {
      case 'WALLET_NOT_CONNECTED':
        return <Wallet className="w-5 h-5" />;
      case 'WRONG_CHAIN':
        return <AlertTriangle className="w-5 h-5" />;
      case 'INSUFFICIENT_GAS':
        return <Fuel className="w-5 h-5" />;
      case 'INSUFFICIENT_BALANCE':
        return <Coins className="w-5 h-5" />;
      default:
        return <AlertTriangle className="w-5 h-5" />;
    }
  };

  const getActionButton = () => {
    switch (error) {
      case 'WALLET_NOT_CONNECTED':
        return (
          <button
            onClick={() => openConnectModal?.()}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-medium rounded-lg transition-all"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        );

      case 'WRONG_CHAIN':
        return (
          <button
            onClick={handleSwitchChain}
            disabled={isSwitching}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-all disabled:opacity-50"
          >
            {isSwitching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Switching...
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                Switch to Sepolia
              </>
            )}
          </button>
        );

      case 'INSUFFICIENT_GAS':
        return (
          <a
            href={FAUCET_URLS.sepoliaEth}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all"
          >
            <Fuel className="w-4 h-4" />
            Get Sepolia ETH
            <ExternalLink className="w-3 h-3" />
          </a>
        );

      case 'INSUFFICIENT_BALANCE':
        return (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg transition-all"
          >
            <Coins className="w-4 h-4" />
            Mint Demo Tokens
          </button>
        );

      default:
        return onRetry ? (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-slate-500 hover:bg-slate-600 text-white font-medium rounded-lg transition-all"
          >
            Try Again
          </button>
        ) : null;
    }
  };

  const getBgColor = () => {
    switch (error) {
      case 'WALLET_NOT_CONNECTED':
        return 'bg-slate-50 border-slate-200';
      case 'WRONG_CHAIN':
        return 'bg-amber-50 border-amber-200';
      case 'INSUFFICIENT_GAS':
        return 'bg-blue-50 border-blue-200';
      case 'INSUFFICIENT_BALANCE':
        return 'bg-purple-50 border-purple-200';
      default:
        return 'bg-red-50 border-red-200';
    }
  };

  const getTextColor = () => {
    switch (error) {
      case 'WALLET_NOT_CONNECTED':
        return 'text-slate-700';
      case 'WRONG_CHAIN':
        return 'text-amber-700';
      case 'INSUFFICIENT_GAS':
        return 'text-blue-700';
      case 'INSUFFICIENT_BALANCE':
        return 'text-purple-700';
      default:
        return 'text-red-700';
    }
  };

  return (
    <div className={`rounded-lg border p-4 ${getBgColor()} ${className}`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-full ${getBgColor()} ${getTextColor()}`}>
          {getIcon()}
        </div>
        <div className="flex-1">
          <h3 className={`font-medium ${getTextColor()}`}>
            {errorInfo.title}
          </h3>
          <p className={`text-sm mt-1 ${getTextColor()} opacity-80`}>
            {errorInfo.message}
          </p>
          <div className="mt-3">
            {getActionButton()}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline version for compact display
 */
export function ExecutionBlockerInline({ error, onRetry }: { error: ExecutionError; onRetry?: () => void }) {
  const [isSwitching, setIsSwitching] = useState(false);
  const { openConnectModal } = useConnectModal();
  const errorInfo = ERROR_MESSAGES[error];

  const handleSwitchChain = async () => {
    setIsSwitching(true);
    await switchToSepolia();
    setIsSwitching(false);
    if (onRetry) onRetry();
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-amber-600">{errorInfo.title}:</span>
      {error === 'WALLET_NOT_CONNECTED' && (
        <button
          onClick={() => openConnectModal?.()}
          className="text-pink-600 hover:text-pink-700 font-medium underline"
        >
          Connect Wallet
        </button>
      )}
      {error === 'WRONG_CHAIN' && (
        <button
          onClick={handleSwitchChain}
          disabled={isSwitching}
          className="text-amber-600 hover:text-amber-700 font-medium underline disabled:opacity-50"
        >
          {isSwitching ? 'Switching...' : 'Switch to Sepolia'}
        </button>
      )}
      {error === 'INSUFFICIENT_GAS' && (
        <a
          href={FAUCET_URLS.sepoliaEth}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 font-medium underline"
        >
          Get Sepolia ETH
        </a>
      )}
    </div>
  );
}
