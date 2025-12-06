/**
 * Position Details Modal
 * Shows detailed information about a strategy/position
 */

import { Strategy, DefiPosition, AccountState } from '../context/BlossomContext';
import { BlossomLogo } from './BlossomLogo';

interface PositionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  strategy?: Strategy | null;
  defiPosition?: DefiPosition | null;
  account?: AccountState;
}

export function PositionDetailsModal({
  isOpen,
  onClose,
  strategy,
  defiPosition,
}: PositionDetailsModalProps) {
  if (!isOpen) return null;

  const position = strategy || defiPosition;
  if (!position) return null;

  const isPerp = strategy && strategy.instrumentType !== 'event' && !defiPosition;
  const isEvent = strategy && strategy.instrumentType === 'event';
  const isDefi = !!defiPosition && !strategy;

  // Calculate days in position (mock)
  const daysInPosition = strategy?.createdAt 
    ? Math.floor((Date.now() - new Date(strategy.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : defiPosition?.createdAt
    ? Math.floor((Date.now() - new Date(defiPosition.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="card-glass p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <BlossomLogo className="h-5 w-5" />
            <h2 className="text-xl font-semibold text-blossom-ink">Position Details</h2>
          </div>
          <button
            onClick={onClose}
            className="text-blossom-slate hover:text-blossom-ink transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Market/Protocol */}
          <div>
            <div className="text-xs text-blossom-slate mb-1">Market / Protocol</div>
            <div className="text-lg font-semibold text-blossom-ink">
              {isEvent && strategy ? (strategy.eventLabel || strategy.eventKey) : 
               isDefi && defiPosition ? `${defiPosition.protocol} - ${defiPosition.asset}` :
               strategy ? strategy.market : 'Unknown'}
            </div>
          </div>

          {/* Status */}
          <div>
            <div className="text-xs text-blossom-slate mb-1">Status</div>
            <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${
              strategy?.status === 'executed' && !strategy?.isClosed
                ? 'bg-blossom-pink text-white'
                : strategy?.isClosed
                ? 'bg-gray-100 text-gray-600'
                : defiPosition?.status === 'active'
                ? 'bg-blossom-pink text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {strategy?.isClosed 
                ? (isEvent && strategy.eventOutcome === 'won' ? 'Settled - Won' :
                   isEvent && strategy.eventOutcome === 'lost' ? 'Settled - Lost' :
                   'Closed')
                : strategy?.status === 'executed' ? 'Executed' :
                defiPosition?.status === 'active' ? 'Active' :
                strategy?.status || 'Draft'}
            </span>
          </div>

          {/* Perp Details */}
          {isPerp && strategy ? (
            <>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-blossom-outline">
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Side</div>
                  <div className={`font-medium ${
                    strategy.side === 'Long' ? 'text-blossom-success' : 'text-blossom-danger'
                  }`}>
                    {strategy.side}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Risk</div>
                  <div className="font-medium text-blossom-ink">{strategy.riskPercent}%</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Entry Price</div>
                  <div className="font-medium text-blossom-ink">${strategy.entry?.toLocaleString() || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Notional</div>
                  <div className="font-medium text-blossom-ink">${(strategy.notionalUsd || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Take Profit</div>
                  <div className="font-medium text-blossom-success">${strategy.takeProfit?.toLocaleString() || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Stop Loss</div>
                  <div className="font-medium text-blossom-danger">${strategy.stopLoss?.toLocaleString() || 'N/A'}</div>
                </div>
              </div>
              {strategy.isClosed && strategy.realizedPnlUsd !== undefined && (
                <div className="pt-3 border-t border-blossom-outline">
                  <div className="text-xs text-blossom-slate mb-1">Realized PnL</div>
                  <div className={`text-lg font-semibold ${
                    strategy.realizedPnlUsd >= 0 ? 'text-blossom-success' : 'text-blossom-danger'
                  }`}>
                    {strategy.realizedPnlUsd >= 0 ? '+' : ''}${strategy.realizedPnlUsd.toFixed(2)}
                    {strategy.realizedPnlPct !== undefined && (
                      <span className="text-sm ml-2">
                        ({strategy.realizedPnlPct >= 0 ? '+' : ''}{strategy.realizedPnlPct.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Event Details */}
          {isEvent && strategy ? (
            <>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-blossom-outline">
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Side</div>
                  <div className={`font-medium ${
                    strategy.eventSide === 'YES' ? 'text-blossom-success' : 'text-blossom-danger'
                  }`}>
                    {strategy.eventSide}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Stake</div>
                  <div className="font-medium text-blossom-ink">${(strategy.stakeUsd || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Max Payout</div>
                  <div className="font-medium text-blossom-success">${(strategy.maxPayoutUsd || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Max Loss</div>
                  <div className="font-medium text-blossom-danger">${(strategy.maxLossUsd || 0).toLocaleString()}</div>
                </div>
              </div>
              {strategy.isClosed && strategy.realizedPnlUsd !== undefined && (
                <div className="pt-3 border-t border-blossom-outline">
                  <div className="text-xs text-blossom-slate mb-1">Settlement Result</div>
                  <div className={`text-lg font-semibold ${
                    strategy.realizedPnlUsd >= 0 ? 'text-blossom-success' : 'text-blossom-danger'
                  }`}>
                    {strategy.eventOutcome === 'won' ? 'Won' : 'Lost'} 
                    {' '}
                    {strategy.realizedPnlUsd >= 0 ? '+' : ''}${strategy.realizedPnlUsd.toFixed(2)}
                  </div>
                </div>
              )}
              {strategy.liveMarkToMarketUsd != null && (
                <div className="mt-4 rounded-xl bg-blossom-pinkSoft/20 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">
                      If this settled at current odds:
                    </span>
                    <span
                      className={`font-semibold ${
                        strategy.liveMarkToMarketUsd >= 0
                          ? 'text-blossom-success'
                          : 'text-blossom-danger'
                      }`}
                    >
                      {strategy.liveMarkToMarketUsd >= 0 ? '+' : '-'}
                      {Math.abs(strategy.liveMarkToMarketUsd).toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Based on current Kalshi / Polymarket prices, purely for SIM
                    mark-to-market. No live orders are placed.
                  </p>
                </div>
              )}
            </>
          ) : null}

          {/* DeFi Details */}
          {isDefi && defiPosition ? (
            <>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-blossom-outline">
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Protocol</div>
                  <div className="font-medium text-blossom-ink">{defiPosition.protocol}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Asset</div>
                  <div className="font-medium text-blossom-ink">{defiPosition.asset}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">Deposit</div>
                  <div className="font-medium text-blossom-ink">${defiPosition.depositUsd.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-blossom-slate mb-1">APY</div>
                  <div className="font-medium text-blossom-success">{defiPosition.apyPct}%</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-blossom-slate mb-1">Days in Position</div>
                  <div className="font-medium text-blossom-ink">{daysInPosition} days</div>
                </div>
              </div>
              <div className="pt-3 border-t border-blossom-outline">
                <div className="text-xs text-blossom-slate mb-1">Estimated Value</div>
                <div className="font-medium text-blossom-ink">
                  ${(defiPosition.depositUsd * (1 + (defiPosition.apyPct / 100) * (daysInPosition / 365))).toFixed(2)}
                </div>
                <div className="text-xs text-blossom-slate mt-1">
                  (Principal + simulated interest)
                </div>
              </div>
            </>
          ) : null}

          {/* Blossom Notes */}
          <div className="pt-4 border-t border-blossom-outline">
            <div className="text-xs font-medium text-blossom-ink mb-2">Blossom Notes</div>
            <ul className="space-y-1 text-xs text-blossom-slate list-disc list-inside">
              {isPerp && strategy && (
                <>
                  <li>Risk is capped at {strategy.riskPercent}% of account value.</li>
                  <li>Stop loss and take profit maintain a comfortable liquidation buffer.</li>
                  <li>This is a simulated position; no real orders are placed.</li>
                </>
              )}
              {isEvent && strategy && (
                <>
                  <li>Event contract risk is capped at your stake amount (${(strategy.stakeUsd || 0).toLocaleString()}).</li>
                  <li>Max payout reflects the odds implied by the market.</li>
                  <li>Your loss is limited to the stake; no liquidation risk.</li>
                </>
              )}
              {isDefi && defiPosition && (
                <>
                  <li>Deposit of ${defiPosition.depositUsd.toLocaleString()} into {defiPosition.protocol}.</li>
                  <li>APY of {defiPosition.apyPct}% is simulated for demo purposes.</li>
                  <li>No real deposits are made; this is a simulation.</li>
                </>
              )}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-blossom-outline flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-blossom-ink bg-blossom-pinkLight rounded-xl hover:bg-blossom-pinkSoft transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

