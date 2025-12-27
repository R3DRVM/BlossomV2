import { useState, useEffect, useRef } from 'react';
import { Strategy, DefiPosition } from '../context/BlossomContext';
import { ChevronDown } from 'lucide-react';
import RiskBadge from './RiskBadge';
import { formatVenueDisplay, formatLeverage, getSimulatedRouteDisplay, formatUsdOrDash, formatEventVenueDisplay } from '../lib/formatPlanCard';
import { getCachedLiveTicker, marketToSpotSymbol, computeIndicativeTpSl, getLiveSpotForMarket } from '../lib/liveSpot';

interface ExecutionDetailsDisclosureProps {
  strategy?: Strategy;
  defiPosition?: DefiPosition;
  venue?: 'hyperliquid' | 'event_demo';
  isExecuted?: boolean;
  executionMode?: 'auto' | 'confirm' | 'manual';
}

export default function ExecutionDetailsDisclosure({
  strategy,
  defiPosition,
  venue = 'hyperliquid',
  isExecuted = false,
  executionMode = 'auto',
}: ExecutionDetailsDisclosureProps) {
  const [showSizing, setShowSizing] = useState(false);
  const [showRiskControls, setShowRiskControls] = useState(false);
  const [showRouting, setShowRouting] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [livePrices, setLivePrices] = useState<{ BTC?: number; ETH?: number; SOL?: number; AVAX?: number; LINK?: number }>({});
  const [liveEntrySnapshot, setLiveEntrySnapshot] = useState<{ entryUsd: number; source: 'coingecko' | 'agent' } | null>(null);
  const isMountedRef = useRef(true);
  
  const planType = strategy?.instrumentType || (defiPosition ? 'defi' : null);
  if (!planType) return null;
  
  // Guard against unmounted component updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch live prices for perp instruments (display-only)
  useEffect(() => {
    if (strategy?.instrumentType === 'perp' && strategy?.market) {
      // Try direct market lookup first
      getLiveSpotForMarket(strategy.market).then(snapshot => {
        if (isMountedRef.current && snapshot) {
          setLiveEntrySnapshot(snapshot);
          const symbol = marketToSpotSymbol(strategy.market);
          if (symbol) {
            setLivePrices(prev => ({ ...prev, [symbol]: snapshot.entryUsd }));
          }
        }
      }).catch(() => {
        // Fail silently
      });

      // Also fetch all prices for compatibility
      getCachedLiveTicker().then(prices => {
        if (isMountedRef.current) {
          setLivePrices(prices);
        }
      }).catch(() => {
        // Fail silently, fall back to strategy values
      });
    }
  }, [strategy?.instrumentType, strategy?.market]);
  
  // Compute live-anchored TP/SL for perps (stable, always defined)
  const spotSymbol = strategy?.market ? marketToSpotSymbol(strategy.market) : null;
  const liveEntry = liveEntrySnapshot?.entryUsd ?? (spotSymbol && livePrices[spotSymbol] ? livePrices[spotSymbol] : null);
  const indicativeTpSl = liveEntry && liveEntry > 0 && strategy?.side ? computeIndicativeTpSl({ side: strategy.side, entry: liveEntry }) : null;
  
  // Use live TP/SL if available, otherwise fall back to strategy values
  const displayTp = indicativeTpSl?.tp ?? strategy?.takeProfit;
  const displaySl = indicativeTpSl?.sl ?? strategy?.stopLoss;
  const hasLiveData = liveEntry !== null && liveEntry > 0;
  
  const hasStopLoss = displaySl && displaySl > 0;
  const hasTakeProfit = displayTp && displayTp > 0;

  return (
    <div className="space-y-2 pt-2 border-t border-blossom-outline/20">
      {/* Sizing */}
      {strategy && (
        <div>
          <button
            onClick={() => setShowSizing(!showSizing)}
            className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span>Sizing</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showSizing ? 'rotate-180' : ''}`} />
          </button>
          {showSizing && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
              {strategy.instrumentType === 'perp' && (
                <>
                  <div className="flex justify-between">
                    <span>Risk:</span>
                    <span className="font-medium">{strategy.riskPercent?.toFixed(1) || '0'}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Leverage:</span>
                    <span className="font-medium">{formatLeverage(strategy.leverage)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Margin:</span>
                    <span className="font-medium">${(strategy.marginUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Notional:</span>
                    <span className="font-medium">${(strategy.notionalUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </>
              )}
              {strategy.instrumentType === 'event' && (
                <>
                  <div className="flex justify-between">
                    <span>Stake:</span>
                    <span className="font-medium">${(strategy.stakeUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Payout:</span>
                    <span className="font-medium">${(strategy.maxPayoutUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Risk controls */}
      {strategy && (
        <div>
          <button
            onClick={() => setShowRiskControls(!showRiskControls)}
            className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span>Risk controls</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showRiskControls ? 'rotate-180' : ''}`} />
          </button>
          {showRiskControls && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
              {strategy.instrumentType === 'perp' && (
                <>
                  {hasStopLoss && (
                    <div className="flex justify-between items-center">
                      <span>Stop Loss:</span>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-rose-600">{formatUsdOrDash(displaySl)}</span>
                        {hasLiveData && (
                          <span 
                            className="text-slate-400 text-[9px]"
                            title="Prices are live. Execution is simulated. TP/SL are indicative for demo."
                          >
                            Live
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {hasTakeProfit && (
                    <div className="flex justify-between items-center">
                      <span>Take Profit:</span>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-emerald-600">{formatUsdOrDash(displayTp)}</span>
                        {hasLiveData && (
                          <span 
                            className="text-slate-400 text-[9px]"
                            title="Prices are live. Execution is simulated. TP/SL are indicative for demo."
                          >
                            Live
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="text-slate-400 text-[9px]">TP/SL placed relative to entry to maintain favorable R:R <span className="text-slate-400">(simulated)</span></div>
                </>
              )}
              {strategy.instrumentType === 'event' && (
                <div className="text-slate-400 text-[9px]">Max loss is capped at stake amount; no liquidation risk <span className="text-slate-400">(simulated)</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Routing */}
      <div>
        <button
          onClick={() => setShowRouting(!showRouting)}
          className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span>Routing</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showRouting ? 'rotate-180' : ''}`} />
        </button>
        {showRouting && (() => {
          // For events, show source-aware venue/chain; for perps, use simulated route
          if (strategy?.instrumentType === 'event') {
            const venueDisplay = formatEventVenueDisplay(strategy.eventMarketSource);
            return (
              <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
                <div className="flex justify-between">
                  <span>Venue:</span>
                  <span className="font-medium">
                    {venueDisplay.venue} <span className="text-slate-400 text-[9px]">(simulated)</span>
                  </span>
                </div>
                {venueDisplay.chain !== '—' && (
                  <div className="flex justify-between">
                    <span>Chain:</span>
                    <span className="font-medium">{venueDisplay.chain} <span className="text-slate-400 text-[9px]">(simulated)</span></span>
                  </div>
                )}
              </div>
            );
          }
          
          const route = getSimulatedRouteDisplay({
            strategyId: strategy?.id,
            market: strategy?.market,
            instrumentType: strategy?.instrumentType,
            executionMode,
          });
          return (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
              <div className="flex justify-between">
                <span>Venue:</span>
                <span className="font-medium">
                  {executionMode === 'auto' || executionMode === undefined
                    ? route.routeNote
                      ? `${route.routeNote} → ${route.venueLabel}`
                      : route.venueLabel
                    : formatVenueDisplay(venue, executionMode)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Chain:</span>
                <span className="font-medium">{route.chainLabel} <span className="text-slate-400 text-[9px]">(simulated)</span></span>
              </div>
              <div className="flex justify-between">
                <span>Est. slippage:</span>
                <span className="font-medium">{route.slippageLabel.split(' (simulated)')[0]} <span className="text-slate-400 text-[9px]">(simulated)</span></span>
              </div>
              <div className="flex justify-between">
                <span>Settlement:</span>
                <span className="font-medium">{route.settlementLabel.split(' (simulated)')[0]} <span className="text-slate-400 text-[9px]">(simulated)</span></span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Assumptions */}
      <div>
        <button
          onClick={() => setShowAssumptions(!showAssumptions)}
          className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span>Assumptions</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showAssumptions ? 'rotate-180' : ''}`} />
        </button>
        {showAssumptions && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
              <div className="text-[9px] text-slate-400 mb-1.5">Model assumptions are simulated for demo purposes.</div>
              {strategy && strategy.instrumentType === 'perp' && (
                <>
                  <div className="text-[9px] text-slate-400">Leverage chosen to keep liquidation buffer above ~15%</div>
                  <div className="text-[9px] text-slate-400">Execution details shown are simulated for demo purposes</div>
                </>
              )}
              {strategy && strategy.instrumentType === 'event' && (
                <>
                  <div className="text-[9px] text-slate-400">Event contract risk is capped at your stake amount</div>
                  <div className="text-[9px] text-slate-400">Max payout reflects the odds implied by the market (1.7x for demo)</div>
                </>
              )}
              {defiPosition && (
                <>
                  <div className="text-[9px] text-slate-400">Protocol selection: Chosen for highest APY within risk band</div>
                  <div className="text-[9px] text-slate-400">Deposit sizing: Optimized for yield while maintaining liquidity</div>
                </>
              )}
          </div>
        )}
      </div>

      {/* Monitoring chips (only when executed) */}
      {isExecuted && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700">
            Monitoring
          </span>
          {hasStopLoss && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-rose-50 text-rose-700">
              SL armed
            </span>
          )}
          {hasTakeProfit && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700">
              TP armed
            </span>
          )}
          {strategy?.riskPercent && (
            <RiskBadge riskPercent={strategy.riskPercent} />
          )}
        </div>
      )}
    </div>
  );
}

