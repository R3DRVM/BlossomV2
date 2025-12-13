import { useEffect, useState } from 'react';
import { ChevronDown, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { useBlossomContext } from '../context/BlossomContext';
import { mockRiskMetrics, mockAlerts } from '../lib/mockData';
import { computeDefiAggregates, computeEventAggregates, computeMarginMetrics } from '../lib/portfolioComputed';
import { computeRiskAlerts, RiskAlert } from '../lib/riskAlerts';
import CorrelationMatrix from './risk/CorrelationMatrix';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

function CollapsibleSection({ title, subtitle, defaultOpen = true, children, className = '' }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex flex-col items-start">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && (
            <span className="text-xs text-gray-500 mt-0.5">{subtitle}</span>
          )}
        </div>
        <ChevronDown 
          className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

interface EditableRiskRulesSectionProps {
  riskProfile: import('../context/BlossomContext').RiskProfile;
  updateRiskProfile: (patch: Partial<import('../context/BlossomContext').RiskProfile>) => void;
  resetRiskProfileToDefault: () => void;
}

function EditableRiskRulesSection({ riskProfile, updateRiskProfile, resetRiskProfileToDefault }: EditableRiskRulesSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState(riskProfile || {
    maxPerTradeRiskPct: 3,
    minLiqBufferPct: 15,
    fundingAlertThresholdPctPer8h: 0.15,
    correlationHedgeThreshold: 0.75,
  });

  useEffect(() => {
    if (riskProfile) {
      setEditValues(riskProfile);
    }
  }, [riskProfile]);

  const handleSave = () => {
    updateRiskProfile(editValues);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValues(riskProfile);
    setIsEditing(false);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="w-full flex items-center justify-between p-4">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 flex items-center justify-between text-left hover:bg-slate-50/50 transition-colors -ml-4 -mr-4 px-4 py-2 rounded"
        >
          <h2 className="text-sm font-semibold text-gray-900">Risk Rules</h2>
          <ChevronDown 
            className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`}
          />
        </button>
        {isOpen && !isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="ml-2 p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-slate-100 transition-colors"
            aria-label="Edit risk rules"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isOpen && (
        <div className="px-4 pb-4">
          {isEditing ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs text-gray-600">Max account risk per strategy (%)</label>
                <input
                  type="number"
                  value={editValues.maxPerTradeRiskPct}
                  onChange={(e) => setEditValues({ ...editValues, maxPerTradeRiskPct: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-600">Min liquidation buffer (%)</label>
                <input
                  type="number"
                  value={editValues.minLiqBufferPct}
                  onChange={(e) => setEditValues({ ...editValues, minLiqBufferPct: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-600">Funding alert threshold (% per 8h)</label>
                <input
                  type="number"
                  value={editValues.fundingAlertThresholdPctPer8h}
                  onChange={(e) => setEditValues({ ...editValues, fundingAlertThresholdPctPer8h: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-600">Correlation hedge threshold</label>
                <input
                  type="number"
                  value={editValues.correlationHedgeThreshold}
                  onChange={(e) => setEditValues({ ...editValues, correlationHedgeThreshold: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                  min="0"
                  max="1"
                  step="0.01"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetRiskProfileToDefault}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Reset to defaults
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-full px-3 py-1.5 text-xs text-gray-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-full bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="mr-2 mt-0.5">✓</span>
                <span>Max account risk per strategy: {riskProfile?.maxPerTradeRiskPct ?? 3}%</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 mt-0.5">✓</span>
                <span>Min liquidation buffer: {riskProfile?.minLiqBufferPct ?? 15}%</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 mt-0.5">✓</span>
                <span>Funding alert threshold: {riskProfile?.fundingAlertThresholdPctPer8h ?? 0.15}% per 8h</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 mt-0.5">✓</span>
                <span>Correlation hedge threshold: {riskProfile?.correlationHedgeThreshold ?? 0.75}</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface LiquidationWatchlistSectionProps {
  executedStrategies: import('../context/BlossomContext').Strategy[];
  manualWatchlist: import('../context/BlossomContext').ManualWatchAsset[];
  addWatchAsset: (asset: Omit<import('../context/BlossomContext').ManualWatchAsset, 'id'>) => void;
  removeWatchAsset: (id: string) => void;
}

function LiquidationWatchlistSection({ executedStrategies, manualWatchlist, addWatchAsset, removeWatchAsset }: LiquidationWatchlistSectionProps) {
  const [isOpen, setIsOpen] = useState(executedStrategies.length > 0 || manualWatchlist.length > 0);
  const [isAdding, setIsAdding] = useState(false);
  const [newAsset, setNewAsset] = useState({ symbol: '', side: 'Long' as 'Long' | 'Short', liqBufferPct: undefined as number | undefined, note: '' });

  const handleAdd = () => {
    if (!newAsset.symbol.trim()) return;
    addWatchAsset({
      symbol: newAsset.symbol.trim(),
      side: newAsset.side,
      liqBufferPct: newAsset.liqBufferPct,
      note: newAsset.note.trim() || undefined,
    });
    setNewAsset({ symbol: '', side: 'Long', liqBufferPct: undefined, note: '' });
    setIsAdding(false);
  };

  const handleCancel = () => {
    setNewAsset({ symbol: '', side: 'Long', liqBufferPct: undefined, note: '' });
    setIsAdding(false);
  };

  const hasAnyItems = executedStrategies.length > 0 || (manualWatchlist && manualWatchlist.length > 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <h2 className="text-sm font-semibold text-gray-900">Liquidation Watchlist</h2>
        <ChevronDown 
          className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <div className="overflow-x-auto">
            {hasAnyItems ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-gray-600 font-medium">Market</th>
                    <th className="text-left py-2 text-gray-600 font-medium">Side</th>
                    <th className="text-left py-2 text-gray-600 font-medium">Liq Buffer</th>
                    <th className="text-left py-2 text-gray-600 font-medium">Note</th>
                    <th className="text-left py-2 text-gray-600 font-medium w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {executedStrategies.map((strategy) => {
                    const liqBuffer = strategy.riskPercent > 3 ? 12 : 15;
                    const isHealthy = liqBuffer >= 15;
                    return (
                      <tr key={strategy.id} className="border-b border-gray-100">
                        <td className="py-2 text-gray-900">{strategy.market}</td>
                        <td className={`py-2 font-medium ${
                          strategy.side === 'Long' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {strategy.side}
                        </td>
                        <td className="py-2 text-gray-900">{liqBuffer}%</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            isHealthy 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {isHealthy ? 'Healthy' : 'Tight buffer'}
                          </span>
                        </td>
                        <td className="py-2"></td>
                      </tr>
                    );
                  })}
                  {manualWatchlist && manualWatchlist.map((asset) => (
                    <tr key={asset.id} className="border-b border-gray-100">
                      <td className="py-2 text-gray-900">{asset.symbol}</td>
                      <td className={`py-2 font-medium ${
                        asset.side === 'Long' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {asset.side}
                      </td>
                      <td className="py-2 text-gray-900">{asset.liqBufferPct ?? '—'}</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700">
                          {asset.note || 'Manual watch'}
                        </span>
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => removeWatchAsset(asset.id)}
                          className="p-1 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          aria-label="Remove asset"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-gray-500 py-4 text-center">
                No active positions to monitor.
              </div>
            )}
          </div>
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="mt-3 text-xs text-blossom-pink hover:text-blossom-pink/80 underline"
            >
              + Add asset to watchlist
            </button>
          ) : (
            <div className="mt-3 space-y-2 p-3 rounded-lg border border-gray-200 bg-slate-50/50">
              <input
                type="text"
                placeholder="ETH-PERP"
                value={newAsset.symbol}
                onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
              />
              <select
                value={newAsset.side}
                onChange={(e) => setNewAsset({ ...newAsset, side: e.target.value as 'Long' | 'Short' })}
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
              >
                <option value="Long">Long</option>
                <option value="Short">Short</option>
              </select>
              <input
                type="number"
                placeholder="Liq buffer (%)"
                value={newAsset.liqBufferPct ?? ''}
                onChange={(e) => setNewAsset({ ...newAsset, liqBufferPct: e.target.value ? parseFloat(e.target.value) : undefined })}
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                min="0"
                max="100"
                step="0.1"
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={newAsset.note}
                onChange={(e) => setNewAsset({ ...newAsset, note: e.target.value })}
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 rounded-full px-3 py-1.5 text-xs text-gray-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="flex-1 rounded-full bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RiskCenter() {
  const { account, strategies, setOnboarding, lastRiskSnapshot, setLastRiskSnapshot, setActiveTab, autoCloseProfitableStrategies, defiPositions, riskProfile, updateRiskProfile, resetRiskProfileToDefault, manualWatchlist, addWatchAsset, removeWatchAsset } = useBlossomContext();
  const [delta, setDelta] = useState<{ valueDelta: number; exposureDelta: number; pnlDelta: number } | null>(null);
  const [autoCloseMessage, setAutoCloseMessage] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<'all' | string>('all');
  
  useEffect(() => {
    setOnboarding(prev => ({ ...prev, openedRiskCenter: true }));
    
    if (!lastRiskSnapshot) {
      setLastRiskSnapshot({
        accountValue: account.accountValue,
        openPerpExposure: account.openPerpExposure,
        totalPnlPct: account.totalPnlPct,
      });
      return;
    }

    const valueDelta = account.accountValue - lastRiskSnapshot.accountValue;
    const exposureDelta = account.openPerpExposure - lastRiskSnapshot.openPerpExposure;
    const pnlDelta = account.totalPnlPct - lastRiskSnapshot.totalPnlPct;

    setDelta({ valueDelta, exposureDelta, pnlDelta });

    setLastRiskSnapshot({
      accountValue: account.accountValue,
      openPerpExposure: account.openPerpExposure,
      totalPnlPct: account.totalPnlPct,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Filter strategies based on strategyFilter
  const filteredStrategies = strategyFilter === 'all'
    ? strategies
    : strategies.filter(s => s.id === strategyFilter);
  
  // Compute correlation based on filtered strategies (exclude closed)
  const executedStrategies = filteredStrategies.filter(s => 
    (s.status === 'executed' || s.status === 'executing') && !s.isClosed
  );
  
  // Compute event market metrics (only open events from filtered strategies)
  const openEventStrategies = filteredStrategies.filter(s => 
    s.instrumentType === 'event' && s.status === 'executed' && !s.isClosed
  );
  
  // All event strategies for alerts (not filtered - for card visibility)
  const eventStrategies = strategies.filter(s => s.instrumentType === 'event');
  
  // Compute event metrics using shared helper (using all strategies for accurate aggregates)
  const eventAggregates = computeEventAggregates(strategies, account);
  const { totalStake: totalEventStake, positionCount: numEventPositions, concentrationPercent: eventConcentrationPct } = eventAggregates;
  const marketGroups = executedStrategies.reduce((acc, s) => {
    const key = `${s.market}-${s.side}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxGroupSize = Math.max(...Object.values(marketGroups), 0);
  const correlation = maxGroupSize > 2 ? 'High' : maxGroupSize > 1 ? 'Medium' : 'Low';
  
  // Count strategies by status (from filtered strategies) - actual counts only
  const draftCount = filteredStrategies.filter(s => s.status === 'draft').length;
  const queuedCount = filteredStrategies.filter(s => s.status === 'queued').length;
  const executingCount = filteredStrategies.filter(s => s.status === 'executing').length;
  const executedCount = filteredStrategies.filter(s => s.status === 'executed').length;
  const closedCount = filteredStrategies.filter(s => s.status === 'closed').length;
  const activeCount = filteredStrategies.filter(
    s => s.status === 'draft' || s.status === 'queued' || s.status === 'executing'
  ).length;
  
  // Compute DeFi aggregates (using shared helper)
  const defiAggregates = computeDefiAggregates(defiPositions);
  const { totalDeposits: totalDefiDeposits, maxProtocolExposure: maxSingleProtocolExposure } = defiAggregates;
  const activeDefiPositions = defiPositions.filter(p => p.status === 'active');
  
  // Get relevant strategies for dropdown (perps and events, excluding closed)
  const relevantStrategies = strategies.filter(s => 
    (s.instrumentType === 'perp' || s.instrumentType === 'event') && 
    s.status !== 'closed'
  );
  
  // Get selected strategy label for display
  const selectedStrategyForFilter = strategyFilter !== 'all' 
    ? strategies.find(s => s.id === strategyFilter)
    : null;
  
  const handleAutoClose = () => {
    const closedCount = autoCloseProfitableStrategies();
    if (closedCount > 0) {
      setAutoCloseMessage(`Closed ${closedCount} profitable strateg${closedCount !== 1 ? 'ies' : 'y'} in SIM.`);
      setTimeout(() => setAutoCloseMessage(null), 5000);
    }
  };
  
  // Compute margin metrics using shared helper
  const { marginUsed, availableMargin } = computeMarginMetrics(account);

  // Compute risk alerts
  const riskAlerts = computeRiskAlerts(account, strategies, defiPositions);

  const handleAlertAction = (alert: RiskAlert) => {
    if (alert.actionType === 'focusPosition' && alert.actionPayload.positionId) {
      setActiveTab('copilot');
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('focusRightPanelPosition', {
            detail: {
              positionId: alert.actionPayload.positionId,
              positionType: strategies.find(s => s.id === alert.actionPayload.positionId)?.instrumentType === 'event' ? 'event' : 'perp',
            },
          })
        );
      }, 100);
    } else if (alert.actionType === 'prefillChat' && alert.actionPayload.chatPrompt) {
      setActiveTab('copilot');
      window.dispatchEvent(
        new CustomEvent('insertChatPrompt', {
          detail: { prompt: alert.actionPayload.chatPrompt },
        })
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-transparent p-6">
      <div className="max-w-7xl mx-auto">
        <p className="text-xs text-blossom-slate mb-4 max-w-2xl">
          Blossom turns your Copilot commands into a risk profile here.
        </p>
        <p className="text-sm text-gray-600 mb-2">
          Blossom monitors account-level risk, liquidation buffers, volatility, and correlation in real time.
        </p>
        <p className="text-sm text-gray-600 mt-1 mb-6">
          Want to adjust this profile?{' '}
          <button
            type="button"
            className="text-blossom-pink underline hover:text-blossom-pink/80"
            onClick={() => setActiveTab('copilot')}
          >
            Ask the Copilot to rebalance →
          </button>
        </p>

        {/* Risk Alerts */}
        {riskAlerts.length > 0 && (
          <div className="mb-4 bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Risk Alerts</h2>
                <p className="text-xs text-gray-500 mt-0.5">{riskAlerts.length} alert{riskAlerts.length !== 1 ? 's' : ''} requiring attention</p>
              </div>
            </div>
            <div className="space-y-2">
              {riskAlerts.map((alert) => {
                const severityColors = {
                  high: 'bg-rose-50 border-rose-200 text-rose-900',
                  med: 'bg-amber-50 border-amber-200 text-amber-900',
                  low: 'bg-blue-50 border-blue-200 text-blue-900',
                };
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${severityColors[alert.severity]}`}
                  >
                    <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                      alert.severity === 'high' ? 'text-rose-600' :
                      alert.severity === 'med' ? 'text-amber-600' :
                      'text-blue-600'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold mb-0.5">{alert.title}</div>
                      <div className="text-xs opacity-90">{alert.detail}</div>
                    </div>
                    <button
                      onClick={() => handleAlertAction(alert)}
                      className="px-3 py-1.5 text-xs font-medium bg-white/80 hover:bg-white rounded-lg transition-colors border border-current/20"
                    >
                      {alert.actionLabel}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* What changed banner */}
        {delta && (Math.abs(delta.valueDelta) > 1 || Math.abs(delta.pnlDelta) > 0.01 || Math.abs(delta.exposureDelta) > 1) && (
          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900">
            <span className="font-medium">Since your last visit:</span>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>Account value: {delta.valueDelta >= 0 ? '+' : '-'}${Math.abs(delta.valueDelta).toFixed(2)}</li>
              <li>Open perp exposure: {delta.exposureDelta >= 0 ? '+' : '-'}${Math.abs(delta.exposureDelta).toFixed(2)}</li>
              <li>Total PnL: {delta.pnlDelta >= 0 ? '+' : '-'}{Math.abs(delta.pnlDelta).toFixed(2)}%</li>
            </ul>
          </div>
        )}
        
        {/* Strategy filter */}
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">View metrics for:</span>
            <select
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-pink-200 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300 transition-colors"
              value={strategyFilter}
              onChange={(e) => {
                setStrategyFilter(e.target.value);
              }}
            >
              <option value="all">All strategies</option>
              {relevantStrategies.map((s) => {
                const marketSymbol = s.instrumentType === 'event' 
                  ? (s.eventLabel || s.eventKey || s.market)
                  : s.market;
                return (
                  <option key={s.id} value={s.id}>
                    {marketSymbol} · {s.side.toUpperCase()} · {s.riskPercent}%
                  </option>
                );
              })}
            </select>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {strategyFilter === 'all' 
              ? 'Showing risk across all open strategies.'
              : 'Metrics below are focused on this strategy only.'}
          </div>
        </div>
        
        {selectedStrategyForFilter && (
          <div className="mb-3 text-xs text-gray-600">
            Metrics focused on: {selectedStrategyForFilter.instrumentType === 'event' 
              ? (selectedStrategyForFilter.eventLabel || selectedStrategyForFilter.eventKey || selectedStrategyForFilter.market)
              : selectedStrategyForFilter.market} {selectedStrategyForFilter.side.toLowerCase()} @ {selectedStrategyForFilter.riskPercent}% risk.
          </div>
        )}
        <div className="lg:grid lg:grid-cols-3 lg:gap-4 space-y-4 lg:space-y-0">
          {/* Left side - 2 columns wide */}
          <div className="lg:col-span-2 space-y-4">
            {/* Account Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Account Overview</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Account Value:</span>
                  <span className="font-medium text-gray-900">${account.accountValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Open Perp Exposure:</span>
                  <span className="font-medium text-gray-900">${account.openPerpExposure.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margin Used:</span>
                  <span className="font-medium text-gray-900">{marginUsed}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Available Margin:</span>
                  <span className="font-medium text-green-600">{availableMargin}%</span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="px-2 py-1 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-full">
                    Mode: SIM
                  </span>
                </div>
              </div>
            </div>

            {/* Risk Metrics */}
            <CollapsibleSection 
              title="Risk Metrics" 
              subtitle="Account-level risk indicators including drawdown, VaR, and volatility"
              defaultOpen={true}
            >
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Drawdown (30d):</span>
                  <span className="font-medium text-red-600">{mockRiskMetrics.maxDrawdown30d}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">24h VaR:</span>
                  <span className="font-medium text-gray-900">{mockRiskMetrics.var24h}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Volatility Regime:</span>
                  <span className="font-medium text-yellow-600">{mockRiskMetrics.volatilityRegime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cross-Position Correlation:</span>
                  <span className={`font-medium ${
                    correlation === 'High' ? 'text-red-600' : correlation === 'Medium' ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {correlation}
                  </span>
                </div>
              </div>
            </CollapsibleSection>
            
            {/* Strategy Status Summary */}
            <CollapsibleSection 
              title="Strategy Status" 
              subtitle="Track your strategies from draft to execution"
              defaultOpen={true}
            >
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Active Strategies:</span>
                  <span className="font-medium text-gray-900">{activeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Draft:</span>
                  <span className="font-medium text-gray-600">{draftCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Queued:</span>
                  <span className="font-medium text-yellow-600">{queuedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Executing:</span>
                  <span className="font-medium text-blue-600">{executingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Executed:</span>
                  <span className="font-medium text-green-600">{executedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Closed:</span>
                  <span className="font-medium text-gray-600">{closedCount}</span>
                </div>
                {activeCount === 0 && draftCount === 0 && executedCount === 0 && closedCount === 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    Run a strategy in the Copilot to see live status here.
                  </p>
                )}
              </div>
            </CollapsibleSection>

            {/* DeFi Exposure */}
            <CollapsibleSection 
              title="DeFi Exposure" 
              defaultOpen={totalDefiDeposits > 0}
            >
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total DeFi deposits:</span>
                  <span className="font-medium text-gray-900">${totalDefiDeposits.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Active DeFi positions:</span>
                  <span className="font-medium text-gray-900">{activeDefiPositions.length}</span>
                </div>
                {maxSingleProtocolExposure > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max single-protocol exposure:</span>
                    <span className="font-medium text-gray-900">${maxSingleProtocolExposure.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* Event Markets Exposure */}
            <CollapsibleSection 
              title="Event Markets Exposure" 
              defaultOpen={totalEventStake > 0}
            >
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total event stake:</span>
                  <span className="font-medium text-gray-900">${totalEventStake.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Open event positions:</span>
                  <span className="font-medium text-gray-900">{numEventPositions}</span>
                </div>
                {eventConcentrationPct > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Largest single event:</span>
                    <span className="font-medium text-gray-900">{eventConcentrationPct.toFixed(1)}% of account</span>
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* Liquidation Watchlist */}
            <LiquidationWatchlistSection 
              executedStrategies={executedStrategies}
              manualWatchlist={manualWatchlist}
              addWatchAsset={addWatchAsset}
              removeWatchAsset={removeWatchAsset}
            />

            {/* Correlation Matrix */}
            <CorrelationMatrix
              account={account}
              strategies={strategies}
              defiPositions={defiPositions}
            />
          </div>

          {/* Right side - 1 column wide */}
          <div className="space-y-4">
            {/* Recent Alerts */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Alerts</h2>
              <div className="space-y-3">
                {mockAlerts.map((alert, idx) => (
                  <div key={idx} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-500 font-mono">{alert.time}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        alert.type === 'warning' 
                          ? 'bg-yellow-100 text-yellow-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {alert.type === 'warning' ? 'Warning' : 'Info'}
                      </span>
                    </div>
                    <p className="text-gray-700 mt-1 ml-12">{alert.message}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Event Alerts (Mock) */}
            {eventStrategies.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-900 mb-1">Event Alerts (Mock)</h2>
                <p className="text-xs text-gray-500 mb-4">Open event market positions and their risk status</p>
                <div className="space-y-3">
                  {openEventStrategies.length > 0 ? (
                    openEventStrategies.map((event) => {
                      const stakeUsd = event.stakeUsd || 0;
                      const riskPct = account.accountValue > 0 ? (stakeUsd / account.accountValue) * 100 : 0;
                      const isHighRisk = riskPct > 5;
                      return (
                        <div key={event.id} className="text-sm">
                          <div className="flex items-start gap-2">
                            <span className="text-xs text-gray-500 font-mono">
                              {new Date(event.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              isHighRisk 
                                ? 'bg-yellow-100 text-yellow-700' 
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {isHighRisk ? 'Risk' : 'Info'}
                            </span>
                          </div>
                          <p className="text-gray-700 mt-1 ml-12">
                            <span className="font-medium">
                              {event.eventLabel || event.eventKey || event.market} – {event.eventSide} stake
                            </span>
                            <br />
                            <span className="text-xs text-gray-500">
                              Stake: ${stakeUsd.toLocaleString()} · Max payoff: ${(event.maxPayoutUsd || stakeUsd * 1.7).toLocaleString()} · Outcome: {event.eventSide}
                            </span>
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-gray-500">
                      No active event market risks right now.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Risk Rules */}
            <EditableRiskRulesSection 
              riskProfile={riskProfile}
              updateRiskProfile={updateRiskProfile}
              resetRiskProfileToDefault={resetRiskProfileToDefault}
            />

            {/* Agent Activity */}
            <CollapsibleSection title="Agent Activity (Mock)" defaultOpen={false}>
              <div className="space-y-2 text-sm text-gray-700 mb-4">
                {autoCloseMessage ? (
                  <div className="rounded-md bg-green-50 px-3 py-2 text-green-800 border border-green-200">
                    {autoCloseMessage}
                  </div>
                ) : (
                  <>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Risk Agent adjusted SL range on SOL-PERP due to volatility.</span>
                    </div>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Execution Agent queued hedge on BTC-PERP after correlation alert.</span>
                    </div>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Strategy Agent suggested reducing exposure in highly correlated pairs.</span>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleAutoClose}
                className="w-full px-4 py-2 text-sm font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-lg hover:bg-blossom-pinkSoft/80 transition-colors"
              >
                Let Blossom lock in profits
              </button>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}

