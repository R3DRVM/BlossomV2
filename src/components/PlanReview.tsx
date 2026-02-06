/**
 * PlanReview Component
 *
 * Displays a structured preview of a parsed intent/plan before execution.
 * Shows:
 * - Intent summary (what the user asked for)
 * - Parsed details (action, amount, asset, target)
 * - Execution route (chain, venue, protocol)
 * - Risk assessment (leverage, liquidation, fees)
 * - Confirm/Reject actions
 *
 * Used in Confirm execution mode to give users full visibility before signing.
 */

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Route,
  Shield,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from 'lucide-react';

export interface ParsedPlan {
  // Intent
  intentId: string;
  originalText: string;

  // Parsed action
  action: 'long' | 'short' | 'swap' | 'deposit' | 'withdraw' | 'bridge' | 'bet';

  // Asset details
  sourceAsset?: string;
  targetAsset?: string;
  amount?: string;
  amountUnit?: 'USD' | 'percent' | 'token';

  // Execution details
  chain: 'ethereum' | 'solana' | 'both';
  venue?: string;
  protocol?: string;

  // Risk parameters
  leverage?: number;
  riskPercent?: number;
  stopLoss?: number;
  takeProfit?: number;
  liquidationPrice?: number;

  // Fees
  estimatedFeeUsd?: number;
  slippageBps?: number;

  // Status
  status: 'pending' | 'confirmed' | 'rejected' | 'executing' | 'executed' | 'failed';

  // Metadata
  createdAt: number;
  expiresAt?: number;
}

interface PlanReviewProps {
  plan: ParsedPlan;
  onConfirm: (intentId: string) => void;
  onReject: (intentId: string) => void;
  isLoading?: boolean;
  className?: string;
  compact?: boolean;
}

// Action display config
const ACTION_CONFIG: Record<ParsedPlan['action'], {
  label: string;
  icon: typeof TrendingUp;
  color: string;
  bgColor: string;
}> = {
  long: {
    label: 'Long',
    icon: TrendingUp,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
  },
  short: {
    label: 'Short',
    icon: TrendingDown,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
  },
  swap: {
    label: 'Swap',
    icon: ArrowRight,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  deposit: {
    label: 'Deposit',
    icon: Wallet,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  withdraw: {
    label: 'Withdraw',
    icon: Wallet,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  bridge: {
    label: 'Bridge',
    icon: Route,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
  },
  bet: {
    label: 'Bet',
    icon: TrendingUp,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
  },
};

// Format amount with unit
function formatAmount(amount: string | undefined, unit: string | undefined, asset?: string): string {
  if (!amount) return '--';

  if (unit === 'USD') {
    return `$${parseFloat(amount).toLocaleString()}`;
  } else if (unit === 'percent') {
    return `${amount}%`;
  } else {
    return `${amount} ${asset || ''}`.trim();
  }
}

// Chain badge component
function ChainBadge({ chain }: { chain: ParsedPlan['chain'] }) {
  const config = {
    ethereum: { label: 'Ethereum', color: 'bg-blue-100 text-blue-700' },
    solana: { label: 'Solana', color: 'bg-purple-100 text-purple-700' },
    both: { label: 'Cross-chain', color: 'bg-gradient-to-r from-blue-100 to-purple-100 text-slate-700' },
  };

  const { label, color } = config[chain];

  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function PlanReview({
  plan,
  onConfirm,
  onReject,
  isLoading = false,
  className = '',
  compact = false,
}: PlanReviewProps) {
  const [showDetails, setShowDetails] = useState(!compact);

  const actionConfig = ACTION_CONFIG[plan.action];
  const ActionIcon = actionConfig.icon;

  // Calculate expiry countdown
  const expiresIn = plan.expiresAt ? Math.max(0, Math.floor((plan.expiresAt - Date.now()) / 1000)) : null;
  const isExpiringSoon = expiresIn !== null && expiresIn < 60;

  // Determine if action buttons should be shown
  const showActions = plan.status === 'pending';
  const isExecuting = plan.status === 'executing';
  const isComplete = plan.status === 'executed' || plan.status === 'failed' || plan.status === 'rejected';

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${className}`}>
      {/* Header */}
      <div className={`px-4 py-3 ${actionConfig.bgColor} border-b border-slate-100`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg bg-white/80 ${actionConfig.color}`}>
              <ActionIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${actionConfig.color}`}>
                  {actionConfig.label}
                </span>
                {plan.targetAsset && (
                  <span className="text-sm font-medium text-slate-700">
                    {plan.targetAsset}
                  </span>
                )}
                {plan.leverage && plan.leverage > 1 && (
                  <span className="px-1.5 py-0.5 bg-white/80 rounded text-[10px] font-bold text-slate-600">
                    {plan.leverage}x
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {plan.originalText.length > 50
                  ? plan.originalText.slice(0, 50) + '...'
                  : plan.originalText
                }
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ChainBadge chain={plan.chain} />
            {expiresIn !== null && (
              <span className={`flex items-center gap-1 text-[10px] ${isExpiringSoon ? 'text-rose-600' : 'text-slate-500'}`}>
                <Clock className="w-3 h-3" />
                {expiresIn}s
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="px-4 py-3">
        {/* Key details row */}
        <div className="flex flex-wrap gap-4 text-xs">
          {/* Amount */}
          {plan.amount && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</div>
              <div className="font-semibold text-slate-900">
                {formatAmount(plan.amount, plan.amountUnit, plan.sourceAsset)}
              </div>
            </div>
          )}

          {/* Risk */}
          {plan.riskPercent !== undefined && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Risk</div>
              <div className={`font-semibold ${plan.riskPercent > 5 ? 'text-rose-600' : 'text-slate-900'}`}>
                {plan.riskPercent}%
              </div>
            </div>
          )}

          {/* Venue/Protocol */}
          {(plan.venue || plan.protocol) && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Via</div>
              <div className="font-semibold text-slate-900">
                {plan.venue || plan.protocol}
              </div>
            </div>
          )}

          {/* Estimated fee */}
          {plan.estimatedFeeUsd !== undefined && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Est. Fee</div>
              <div className="font-semibold text-slate-900">
                ${plan.estimatedFeeUsd.toFixed(2)}
              </div>
            </div>
          )}
        </div>

        {/* Expandable details */}
        {!compact && (
          <>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 mt-3 text-[10px] text-slate-500 hover:text-slate-700"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? 'Hide details' : 'Show details'}
            </button>

            {showDetails && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                {/* Stop Loss / Take Profit */}
                {(plan.stopLoss !== undefined || plan.takeProfit !== undefined) && (
                  <div className="flex gap-4 text-xs">
                    {plan.stopLoss !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-rose-600">SL:</span>
                        <span className="font-medium">${plan.stopLoss.toLocaleString()}</span>
                      </div>
                    )}
                    {plan.takeProfit !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-emerald-600">TP:</span>
                        <span className="font-medium">${plan.takeProfit.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Liquidation warning */}
                {plan.liquidationPrice !== undefined && (
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 rounded-lg text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>
                      Liquidation at <strong>${plan.liquidationPrice.toLocaleString()}</strong>
                    </span>
                  </div>
                )}

                {/* Slippage */}
                {plan.slippageBps !== undefined && (
                  <div className="text-[10px] text-slate-500">
                    Max slippage: {(plan.slippageBps / 100).toFixed(2)}%
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
          <div className="flex gap-2">
            <button
              onClick={() => onReject(plan.intentId)}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              onClick={() => onConfirm(plan.intentId)}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-pink-500 to-pink-600 text-white text-xs font-medium hover:from-pink-600 hover:to-pink-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Executing state */}
      {isExecuting && (
        <div className="px-4 py-3 border-t border-slate-100 bg-blue-50">
          <div className="flex items-center justify-center gap-2 text-blue-700 text-xs font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            Executing transaction...
          </div>
        </div>
      )}

      {/* Complete state */}
      {isComplete && (
        <div className={`px-4 py-3 border-t border-slate-100 ${
          plan.status === 'executed' ? 'bg-emerald-50' :
          plan.status === 'rejected' ? 'bg-slate-50' :
          'bg-rose-50'
        }`}>
          <div className={`flex items-center justify-center gap-2 text-xs font-medium ${
            plan.status === 'executed' ? 'text-emerald-700' :
            plan.status === 'rejected' ? 'text-slate-600' :
            'text-rose-700'
          }`}>
            {plan.status === 'executed' && <CheckCircle className="w-4 h-4" />}
            {plan.status === 'rejected' && <XCircle className="w-4 h-4" />}
            {plan.status === 'failed' && <AlertTriangle className="w-4 h-4" />}
            {plan.status === 'executed' ? 'Executed successfully' :
             plan.status === 'rejected' ? 'Plan rejected' :
             'Execution failed'}
          </div>
        </div>
      )}
    </div>
  );
}

// Export compact version for inline use
export function PlanReviewCompact(props: Omit<PlanReviewProps, 'compact'>) {
  return <PlanReview {...props} compact />;
}
