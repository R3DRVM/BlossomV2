import { useState } from 'react';
import { DefiPosition, useBlossomContext } from '../context/BlossomContext';
import { DEMO_STABLE_ALT_SYMBOL, DEMO_STABLE_INTERNAL_SYMBOL, brandStableText, formatTokenSymbol } from '../lib/tokenBranding';

interface DeFiSummaryCardProps {
  position: DefiPosition;
  onInsertPrompt?: (text: string) => void;
}

type RiskPreference = 'conservative' | 'balanced' | 'aggressive';
const STABLE_SYMBOLS = new Set([
  DEMO_STABLE_INTERNAL_SYMBOL.toUpperCase(),
  DEMO_STABLE_ALT_SYMBOL.toUpperCase(),
  'REDACTED',
  'USDC',
  'BUSDC',
]);

export default function DeFiSummaryCard({ position, onInsertPrompt }: DeFiSummaryCardProps) {
  const { confirmDefiPlan, updateDeFiPlanDeposit, account } = useBlossomContext();
  const [isEditingDeposit, setIsEditingDeposit] = useState(false);
  const [isExecutingPlan, setIsExecutingPlan] = useState(false);
  const [editDepositValue, setEditDepositValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [riskPreference, setRiskPreference] = useState<RiskPreference>('balanced');

  const isProposed = position.status === 'proposed';
  const isActive = position.status === 'active';

  return (
    <div className="card-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-blossom-ink">DeFi Plan</h2>
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
          isProposed 
            ? 'text-blossom-slate bg-gray-100' 
            : 'text-white bg-blossom-pink'
        }`}>
          {isProposed ? 'Proposed' : 'Active'}
        </span>
      </div>

      <div className="space-y-3 text-sm mb-4">
        <div className="flex justify-between">
          <span className="text-blossom-slate">Protocol:</span>
          <span className="font-medium text-blossom-ink">{brandStableText(position.protocol)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Asset:</span>
          <span className="font-medium text-blossom-ink">{formatTokenSymbol(position.asset)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">APY:</span>
          <span className="font-medium text-blossom-success">{position.apyPct}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Deposit Amount:</span>
          <span className="font-medium text-blossom-ink">${position.depositUsd.toLocaleString()}</span>
        </div>
      </div>

      {(isProposed || isActive) && (
        <div className="space-y-2 pt-4 border-t border-blossom-outline/50">
          {!isEditingDeposit ? (
            <>
              {isActive && (
                <button
                  onClick={() => {
                    setIsEditingDeposit(true);
                    setEditDepositValue(position.depositUsd.toString());
                    setEditError(null);
                  }}
                  className="w-full px-3 py-2 text-xs font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
                >
                  Edit deposit
                </button>
              )}
              
              {/* Risk preference selector for optimize yield */}
              <div className="mb-2">
                <label className="block text-xs font-medium text-blossom-slate mb-1.5">Risk preference</label>
                <div className="flex gap-1">
                  {(['conservative', 'balanced', 'aggressive'] as RiskPreference[]).map((pref) => (
                    <button
                      key={pref}
                      onClick={() => setRiskPreference(pref)}
                      className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                        riskPreference === pref
                          ? 'bg-blossom-pink text-white'
                          : 'bg-white border border-blossom-outline/60 text-blossom-slate hover:bg-blossom-pinkSoft/40'
                      }`}
                    >
                      {pref.charAt(0).toUpperCase() + pref.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              
              <button
                onClick={() => {
                  if (!onInsertPrompt) return;
                  
                  const prompts = {
                    conservative: 'Optimize my DeFi yield prioritizing safety and blue-chip protocols, even if APY is lower.',
                    balanced: 'Optimize my DeFi yield mixing safety and moderate risk to improve APY without extreme tail risk.',
                    aggressive: 'Optimize my DeFi yield using more aggressive protocols. I\'m comfortable taking on higher risk for higher APY. Show me a new plan and explain the trade-offs.',
                  };
                  
                  onInsertPrompt(prompts[riskPreference]);
                }}
                className="w-full px-3 py-2 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-lg hover:bg-blossom-pinkSoft/60 transition-colors"
              >
                Ask Blossom: optimize yield
              </button>
              
              {isProposed && (
                <>
                  <button
                    onClick={async () => {
                      if (isExecutingPlan) return;
                      setIsExecutingPlan(true);
                      try {
                        await Promise.resolve(confirmDefiPlan(position.id));
                      } finally {
                        setIsExecutingPlan(false);
                      }
                    }}
                    disabled={isExecutingPlan}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      !isExecutingPlan
                        ? 'text-white bg-blossom-pink hover:bg-blossom-pink/90'
                        : 'bg-blossom-outline/40 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isExecutingPlan ? 'Executing...' : 'Execute plan'}
                  </button>
                </>
              )}
            </>
          ) : (
              <div className="space-y-3">
                <div>
                <label className="block text-xs font-medium text-blossom-ink mb-1">New deposit amount (bUSDC)</label>
                <input
                  type="number"
                  value={editDepositValue}
                  onChange={(e) => {
                    setEditDepositValue(e.target.value);
                    setEditError(null);
                  }}
                  className="w-full px-3 py-2 text-sm border border-blossom-outline/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-blossom-pink/30"
                  placeholder="Enter deposit amount"
                  min="0"
                  step="0.01"
                />
                <div className="mt-1 text-xs text-blossom-slate">
                  This is simulated; no real deposits.
                </div>
              </div>
              {editError && (
                <div className="text-xs text-blossom-danger bg-blossom-danger/10 px-2 py-1 rounded">
                  {editError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const newDeposit = parseFloat(editDepositValue);
                    if (isNaN(newDeposit) || newDeposit < 0) {
                      setEditError('Please enter a valid deposit amount (≥ 0)');
                      return;
                    }
                    
                    const accountValue = account.accountValue;
                    if (newDeposit > accountValue) {
                      setEditError(`Deposit cannot exceed account value ($${accountValue.toLocaleString()})`);
                      return;
                    }
                    
                    const usdcBalance = account.balances.find(b => STABLE_SYMBOLS.has(String(b.symbol || '').toUpperCase()))?.balanceUsd || 0;
                    const depositDelta = newDeposit - position.depositUsd;
                    
                    // Check if we have enough REDACTED for increase
                    if (depositDelta > 0 && usdcBalance < depositDelta) {
                      setEditError(`Insufficient bUSDC. Available: $${usdcBalance.toLocaleString()}, needed: $${depositDelta.toLocaleString()}`);
                      return;
                    }
                    
                    updateDeFiPlanDeposit(position.id, newDeposit);
                    setIsEditingDeposit(false);
                    setEditError(null);
                  }}
                  disabled={!editDepositValue || parseFloat(editDepositValue) < 0}
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blossom-pink rounded-lg hover:bg-[#FF5A96] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save changes
                </button>
                <button
                  onClick={() => {
                    setIsEditingDeposit(false);
                    setEditError(null);
                  }}
                  className="px-3 py-2 text-xs font-medium text-blossom-slate bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transaction hash display for active positions */}
      {position.status === 'active' && position.txHash && (
        <div className="border-t border-blossom-outline/50 pt-3 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blossom-slate">Transaction</span>
            <a
              href={position.explorerUrl || `https://sepolia.etherscan.io/tx/${position.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blossom-pink hover:underline inline-flex items-center gap-1"
            >
              View on Etherscan →
            </a>
          </div>
          <div className="text-xs text-blossom-slate/60 mt-1 font-mono truncate">
            {position.txHash}
          </div>
        </div>
      )}
    </div>
  );
}
