/**
 * Intent Execution Card
 *
 * Displays intent execution status and results in the chat UI.
 * Matches existing Blossom card styling (card-glass, strategy-card).
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
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

// Status badge colors matching existing theme
const getStatusColor = (status: string): string => {
  switch (status) {
    case 'confirmed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'executing':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'queued':
    case 'planned':
    case 'routed':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
  }
};

// Get chain badge color
const getChainColor = (chain: string): string => {
  switch (chain) {
    case 'ethereum':
      return 'bg-blue-900/50 text-blue-400';
    case 'solana':
      return 'bg-purple-900/50 text-purple-400';
    default:
      return 'bg-gray-900/50 text-gray-400';
  }
};

// Copy to clipboard helper
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy:', err);
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
  const [isExpanded, setIsExpanded] = useState(false);
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
      <div className="card-glass strategy-card p-4 my-2">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blossom-pink animate-spin" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-white">Executing Intent</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">"{intentText}"</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Processing...
          </span>
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
  const isProofOnly = metadata?.executedKind === 'proof_only';
  const isPlanOnly = status === 'planned' && metadata?.planOnly;

  // Get header text based on status
  const getHeaderText = () => {
    if (isPlanOnly) return 'Intent Ready';
    if (ok && status === 'confirmed') return 'Intent Executed';
    if (!ok || status === 'failed') return 'Execution Failed';
    return 'Intent Processing';
  };

  // Get header icon
  const getHeaderIcon = () => {
    if (isPlanOnly) return <Zap className="w-5 h-5 text-blue-500" />;
    if (ok && status === 'confirmed') return <CheckCircle className="w-5 h-5 text-green-500" />;
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  return (
    <div className="card-glass strategy-card p-4 my-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {getHeaderIcon()}
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-white">
              {getHeaderText()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-[300px] truncate">
              "{intentText}"
            </p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 ${getStatusColor(status)}`}>
          {status === 'confirmed' && <CheckCircle className="w-3 h-3" />}
          {status === 'failed' && <XCircle className="w-3 h-3" />}
          {status === 'executing' && <Loader2 className="w-3 h-3 animate-spin" />}
          {status === 'planned' && <Clock className="w-3 h-3" />}
          {status}
        </span>
      </div>

      {/* Confirm Button for planned intents */}
      {isPlanOnly && onConfirm && result.intentId && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onConfirm(result.intentId)}
            disabled={isConfirming}
            className="w-full py-2 px-4 bg-blossom-pink hover:bg-blossom-pink/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Confirm & Execute
              </>
            )}
          </button>
          {route?.warnings && route.warnings.length > 0 && (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{route.warnings[0]}</span>
            </div>
          )}
        </div>
      )}

      {/* Execution Details Row */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {/* Chain/Network */}
        {route && (
          <span className={`px-2 py-0.5 rounded ${getChainColor(route.chain)}`}>
            {route.chain}/{route.network}
          </span>
        )}

        {/* Venue */}
        {route?.venue && (
          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {route.venue}
          </span>
        )}

        {/* Kind */}
        {parsed?.kind && (
          <span className="px-2 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400">
            {parsed.kind}
          </span>
        )}

        {/* Proof Only Indicator */}
        {isProofOnly && (
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            proof_only
          </span>
        )}
      </div>

      {/* Explorer Link - Always visible when available */}
      {txHash && explorerUrl && (
        <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Zap className="w-3 h-3 text-green-500" />
              <span className="text-gray-600 dark:text-gray-400">TX:</span>
              <code className="text-gray-800 dark:text-gray-200 font-mono">
                {txHash.slice(0, 10)}...{txHash.slice(-6)}
              </code>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopy(txHash, 'tx')}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                title="Copy TX Hash"
              >
                <Copy className="w-3 h-3 text-gray-500" />
              </button>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                title="View on Explorer"
              >
                <ExternalLink className="w-3 h-3 text-blue-500" />
              </a>
            </div>
          </div>
          {copied === 'tx' && (
            <span className="text-xs text-green-500 ml-2">Copied!</span>
          )}
        </div>
      )}

      {/* Error Display - Compact with collapsible details */}
      {error && (
        <div className="mt-3 text-xs">
          {/* Compact error row */}
          <div className="flex items-center justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-red-200 dark:border-red-900/50">
            <div className="flex items-center gap-2 min-w-0">
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 truncate">
                Execution failed: <span className="font-medium text-red-600 dark:text-red-400">{error.code}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => setIsErrorExpanded(!isErrorExpanded)}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                {isErrorExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Details
              </button>
            </div>
          </div>
          {/* Expanded error details */}
          {isErrorExpanded && (
            <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800/30 rounded-lg text-gray-600 dark:text-gray-400">
              <p className="text-xs text-gray-500 mb-1">Stage: {error.stage}</p>
              <p className="text-xs break-words">{error.message}</p>
              {result?.intentId && (
                <a
                  href={`/dev/stats?intent=${result.intentId}`}
                  className="inline-flex items-center gap-1 mt-2 text-blue-500 hover:text-blue-600"
                >
                  <ExternalLink className="w-3 h-3" />
                  View in Dev Stats
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expandable Details */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="mt-3 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        {isExpanded ? 'Hide Details' : 'Show Details'}
      </button>

      {isExpanded && (
        <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs space-y-2">
          {/* Intent ID */}
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Intent ID:</span>
            <div className="flex items-center gap-1">
              <code className="text-gray-700 dark:text-gray-300 font-mono">
                {result.intentId.slice(0, 12)}...
              </code>
              <button
                onClick={() => handleCopy(result.intentId, 'intentId')}
                className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                <Copy className="w-3 h-3 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Execution ID */}
          {result.executionId && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Execution ID:</span>
              <div className="flex items-center gap-1">
                <code className="text-gray-700 dark:text-gray-300 font-mono">
                  {result.executionId.slice(0, 12)}...
                </code>
                <button
                  onClick={() => handleCopy(result.executionId!, 'execId')}
                  className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                >
                  <Copy className="w-3 h-3 text-gray-400" />
                </button>
              </div>
            </div>
          )}

          {/* Parsed Details */}
          {parsed && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Action:</span>
                <span className="text-gray-700 dark:text-gray-300">{parsed.action}</span>
              </div>
              {parsed.amount && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Amount:</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {parsed.amount} {parsed.amountUnit}
                  </span>
                </div>
              )}
              {parsed.targetAsset && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Target:</span>
                  <span className="text-gray-700 dark:text-gray-300">{parsed.targetAsset}</span>
                </div>
              )}
              {parsed.leverage && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Leverage:</span>
                  <span className="text-gray-700 dark:text-gray-300">{parsed.leverage}x</span>
                </div>
              )}
            </>
          )}

          {/* Warnings */}
          {route?.warnings && route.warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <p className="text-amber-600 dark:text-amber-400 font-medium mb-1">Notes:</p>
              {route.warnings.map((warning, i) => (
                <p key={i} className="text-gray-600 dark:text-gray-400 text-xs">
                  • {warning}
                </p>
              ))}
            </div>
          )}

          {/* Dual-chain proof (for bridge intents) */}
          {metadata?.destChainProof && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <p className="text-purple-600 dark:text-purple-400 font-medium mb-1">Destination Chain Proof:</p>
              <div className="flex items-center justify-between">
                <code className="text-gray-700 dark:text-gray-300 font-mono text-xs">
                  {metadata.destChainProof.txHash.slice(0, 10)}...
                </code>
                <a
                  href={metadata.destChainProof.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  View
                </a>
              </div>
            </div>
          )}

          {/* Dev Stats Link */}
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <a
              href={`/dev/stats?intent=${result.intentId}`}
              className="text-blue-500 hover:text-blue-600 text-xs flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              View in Dev Stats
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
