/**
 * Intent Execution Card
 *
 * Unified plan card for all intent types (perp, swap, deposit, bridge, event).
 * Matches the existing Blossom strategy-card template for consistent UX.
 */

import React, { useState } from 'react';
import {
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { IntentExecutionResult } from '../lib/apiClient';

interface IntentExecutionCardProps {
  intentText: string;
  result: IntentExecutionResult | null;
  isExecuting: boolean;
  onRetry?: () => void;
  onConfirm?: (intentId: string) => void;
  isConfirming?: boolean;
}

// Copy to clipboard helper
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
};

// Format USD values consistently
const formatUsd = (value: number | string | undefined | null): string => {
  if (value === undefined || value === null) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

// Derive card title from intent kind
const getCardTitle = (parsed: any, intentText: string): string => {
  if (!parsed) return intentText.slice(0, 50);
  switch (parsed.kind) {
    case 'perp':
      return `${parsed.targetAsset || 'PERP'}-PERP`;
    case 'swap':
      return `Swap ${parsed.amountUnit || ''} → ${parsed.targetAsset || ''}`.trim();
    case 'lend_supply':
    case 'deposit':
      return `Deposit ${parsed.amountUnit || ''}`;
    case 'bridge':
      return `Bridge ${parsed.amountUnit || ''}`;
    case 'event':
      return parsed.market || 'Event Market';
    default:
      return parsed.action || intentText.slice(0, 30);
  }
};

// Get side/direction display for different intent kinds
const getSideDisplay = (parsed: any): { label: string; value: string; color: string } | null => {
  if (!parsed) return null;
  switch (parsed.kind) {
    case 'perp':
      const direction = parsed.direction || (parsed.action?.toLowerCase().includes('long') ? 'long' : 'short');
      return {
        label: 'Side',
        value: direction === 'long' ? 'Long' : 'Short',
        color: direction === 'long' ? 'text-emerald-600' : 'text-rose-600',
      };
    case 'swap':
      return {
        label: 'From → To',
        value: `${parsed.amountUnit || '?'} → ${parsed.targetAsset || '?'}`,
        color: 'text-slate-700',
      };
    case 'lend_supply':
    case 'deposit':
      return {
        label: 'Asset',
        value: parsed.amountUnit || parsed.targetAsset || '—',
        color: 'text-slate-700',
      };
    case 'bridge':
      return {
        label: 'Route',
        value: `${parsed.sourceChain || 'ETH'} → ${parsed.destChain || 'SOL'}`,
        color: 'text-purple-600',
      };
    case 'event':
      return {
        label: 'Side',
        value: parsed.side || 'YES',
        color: parsed.side === 'NO' ? 'text-rose-600' : 'text-emerald-600',
      };
    default:
      return null;
  }
};

export default function IntentExecutionCard({
  intentText,
  result,
  isExecuting,
  onRetry,
  onConfirm,
  isConfirming = false,
}: IntentExecutionCardProps) {
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // Render loading state
  if (isExecuting && !result) {
    return (
      <div className="mt-1.5 w-full max-w-md strategy-card card-glass">
        <div className="p-3 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blossom-pink animate-spin" />
          <div>
            <p className="text-xs font-semibold text-blossom-ink">Executing Intent</p>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[280px]">"{intentText}"</p>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const { ok, status, txHash, explorerUrl, error, metadata } = result;
  const parsed = metadata?.parsed;
  const route = metadata?.route;
  const isPlanOnly = status === 'planned' && metadata?.planOnly;
  const isExecuted = status === 'confirmed' && ok;
  const isFailed = status === 'failed' || !ok;

  const cardTitle = getCardTitle(parsed, intentText);
  const sideDisplay = getSideDisplay(parsed);

  // Status text styling: subtle inline text, not badge
  const getStatusText = () => {
    if (isPlanOnly) return { text: 'planned', className: 'text-blossom-pink' };
    if (isExecuted) return { text: 'executed', className: 'text-slate-500' };
    if (isFailed) return { text: 'failed', className: 'text-slate-500' };
    return { text: status, className: 'text-slate-500' };
  };
  const statusDisplay = getStatusText();

  return (
    <div className="mt-1.5 w-full max-w-md strategy-card card-glass transition-all duration-300">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsCardExpanded(!isCardExpanded)}
        className="w-full flex items-center justify-between p-3 pb-1.5 border-b border-blossom-outline/20 hover:bg-slate-50/50 transition-colors"
      >
        <h3 className="text-xs font-semibold text-blossom-ink truncate max-w-[200px]">
          {cardTitle}
        </h3>
        <div className="flex items-center gap-2">
          {/* Status as subtle inline text */}
          <span className={`text-[10px] font-medium ${statusDisplay.className}`}>
            {statusDisplay.text}
          </span>
          <svg
            className={`w-3 h-3 text-slate-400 transition-transform ${isCardExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Collapsed: 2 compact rows */}
      {!isCardExpanded && (
        <div className="px-3 py-2 space-y-1.5 text-[11px]">
          {/* Row 1: Primary info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {sideDisplay && (
                <>
                  <span className={`font-medium ${sideDisplay.color}`}>
                    {sideDisplay.value}
                  </span>
                  <span className="text-slate-400">•</span>
                </>
              )}
              <span className="text-slate-600 truncate">
                {parsed?.amount ? formatUsd(parsed.amount) : '—'}
              </span>
            </div>
            {parsed?.leverage && (
              <span className="text-slate-500 flex-shrink-0">
                {parsed.leverage}x leverage
              </span>
            )}
          </div>

          {/* Row 2: Routing/Execution */}
          <div className="flex items-center justify-between text-slate-500">
            <span className="truncate">
              {route ? `${route.venue || '—'} • ${route.chain}/${route.network}` : 'Routing...'}
            </span>
            {txHash && (
              <span className="flex-shrink-0 text-[9px] text-emerald-600">✓ On-chain</span>
            )}
          </div>

          {/* Chips row */}
          {(isPlanOnly || isExecuted || isFailed) && (
            <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
              {isPlanOnly && (
                <span className="text-slate-500 text-[10px]">Ready to confirm</span>
              )}
              {isExecuted && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 whitespace-nowrap">
                  Confirmed
                </span>
              )}
              {isFailed && error && (
                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                  <AlertTriangle className="w-3 h-3" />
                  {error.code}
                </span>
              )}
            </div>
          )}

          {/* CTA row (collapsed) - only for planned intents */}
          {isPlanOnly && onConfirm && result.intentId && (
            <div className="pt-1.5 border-t border-slate-100">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onConfirm(result.intentId);
                }}
                disabled={isConfirming}
                className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  !isConfirming
                    ? 'bg-blossom-pink text-white hover:bg-blossom-pink/90 shadow-sm'
                    : 'bg-blossom-outline/40 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Executing...
                  </span>
                ) : (
                  'Confirm & Execute'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expanded: Full details */}
      {isCardExpanded && (
        <div className="max-h-[60vh] overflow-y-auto p-3 pt-1.5">
          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-1.5 text-xs mb-2">
            {sideDisplay && (
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">{sideDisplay.label}</div>
                <div className={`font-medium ${sideDisplay.color}`}>{sideDisplay.value}</div>
              </div>
            )}
            {parsed?.amount && (
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Amount</div>
                <div className="font-medium text-blossom-ink">{formatUsd(parsed.amount)}</div>
              </div>
            )}
            {parsed?.leverage && (
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Leverage</div>
                <div className="font-medium text-blossom-ink">{parsed.leverage}x</div>
              </div>
            )}
            {parsed?.targetAsset && (
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Target</div>
                <div className="font-medium text-blossom-ink">{parsed.targetAsset}</div>
              </div>
            )}
          </div>

          {/* Interpretation line */}
          <div className="mt-1.5 px-0 pb-1.5">
            <p className="text-[11px] text-slate-500">
              Blossom interpreted this as:{' '}
              <span className="font-medium text-slate-700">{parsed?.action || intentText.slice(0, 40)}</span>
              {parsed?.amount && ` for ${formatUsd(parsed.amount)}`}
              {parsed?.targetAsset && ` targeting ${parsed.targetAsset}`}
              {parsed?.leverage && ` at ${parsed.leverage}x`}.
            </p>
          </div>

          {/* Warning box for route warnings */}
          {route?.warnings && route.warnings.length > 0 && (
            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <ul className="text-xs text-amber-700 space-y-0.5">
                    {route.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error display - compact row with optional expand */}
          {error && (
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-3 h-3 text-slate-500 flex-shrink-0" />
                  <span className="text-[11px] text-slate-600 truncate">
                    {error.code}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="px-2 py-0.5 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition-colors"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => setIsErrorExpanded(!isErrorExpanded)}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {isErrorExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Details
                  </button>
                </div>
              </div>
              {isErrorExpanded && (
                <div className="mt-1 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-600">
                  <p className="text-slate-500 mb-1">Stage: {error.stage}</p>
                  <p className="break-words">{error.message}</p>
                </div>
              )}
            </div>
          )}

          {/* CTA button for planned intents (expanded) */}
          {isPlanOnly && onConfirm && result.intentId && (
            <div className="pt-3 border-t border-slate-100">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onConfirm(result.intentId);
                }}
                disabled={isConfirming}
                className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  !isConfirming
                    ? 'bg-blossom-pink text-white hover:bg-blossom-pink/90 shadow-sm'
                    : 'bg-blossom-outline/40 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Executing...
                  </span>
                ) : (
                  'Confirm & Execute'
                )}
              </button>
            </div>
          )}

          {/* Route + Details accordion */}
          <div className="mt-3 pt-2 border-t border-slate-100">
            <div className="space-y-1.5 text-[11px]">
              {/* Route info */}
              {route && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Route</span>
                  <span className="text-slate-700">{route.venue} • {route.chain}/{route.network}</span>
                </div>
              )}

              {/* TX hash with explorer link */}
              {txHash && explorerUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">TX</span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-slate-700 font-mono text-[10px]">
                      {txHash.slice(0, 8)}...{txHash.slice(-4)}
                    </code>
                    <button
                      onClick={() => handleCopy(txHash, 'tx')}
                      className="p-0.5 hover:bg-slate-200 rounded transition-colors"
                      title="Copy"
                    >
                      <Copy className="w-3 h-3 text-slate-400" />
                    </button>
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-0.5 hover:bg-slate-200 rounded transition-colors"
                      title="View on Explorer"
                    >
                      <ExternalLink className="w-3 h-3 text-blue-500" />
                    </a>
                    {copied === 'tx' && <span className="text-emerald-500 text-[9px]">Copied!</span>}
                  </div>
                </div>
              )}

              {/* Dual-chain proof (for bridge) */}
              {metadata?.destChainProof && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Dest Chain Proof</span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-purple-700 font-mono text-[10px]">
                      {metadata.destChainProof.txHash.slice(0, 8)}...
                    </code>
                    <a
                      href={metadata.destChainProof.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-0.5 hover:bg-slate-200 rounded transition-colors"
                    >
                      <ExternalLink className="w-3 h-3 text-purple-500" />
                    </a>
                  </div>
                </div>
              )}

              {/* Dev Stats link */}
              <div className="pt-1.5">
                <a
                  href={`/dev/stats?intent=${result.intentId}`}
                  className="text-blue-500 hover:text-blue-600 text-[10px] flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  View in Dev Stats
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
