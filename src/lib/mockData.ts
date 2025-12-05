export interface MockPosition {
  market: string;
  side: 'Long' | 'Short';
  size: string;
  entry: string;
  pnl: string;
  liqBuffer?: number;
  note?: string;
}

export interface MockAccount {
  accountValue: number;
  openPerpExposure: number;
  marginUsed: number;
  availableMargin: number;
  totalPnL: number;
  pnl30d: number;
}

export const mockPositions: MockPosition[] = [
  { market: 'ETH-PERP', side: 'Long', size: '0.5', entry: '$3,500', pnl: '+2.3%', liqBuffer: 16, note: 'Healthy' },
  { market: 'BTC-PERP', side: 'Short', size: '0.1', entry: '$45,000', pnl: '-0.8%', liqBuffer: 9, note: 'Tight buffer' },
  { market: 'SOL-PERP', side: 'Long', size: '2.0', entry: '$100', pnl: '+1.2%', liqBuffer: 18, note: 'Healthy' },
];

export const mockAccount: MockAccount = {
  accountValue: 125000,
  openPerpExposure: 45000,
  marginUsed: 38,
  availableMargin: 62,
  totalPnL: 12.4,
  pnl30d: 4.1,
};

export const mockRiskMetrics = {
  maxDrawdown30d: -7.5,
  var24h: 2.3,
  volatilityRegime: 'High' as const,
  crossPositionCorrelation: 'Low' as const,
};

export const mockAlerts = [
  { time: '10:12', message: 'Funding spike detected on BTC-PERP – monitoring.', type: 'warning' as const },
  { time: '09:47', message: 'SOL-PERP volatility increased – widening SL range.', type: 'info' as const },
  { time: '09:15', message: 'Cross-position correlation elevated – hedging suggested.', type: 'warning' as const },
];

export const mockRiskRules = [
  'Max account risk per strategy: 3%',
  'Min liquidation buffer: 15%',
  'Alert if funding > 0.15% / 8h',
  'Auto-hedge if correlation > 0.75',
];

export const mockPortfolioStats = {
  winRate: 58,
  avgRR: 1.8,
  bestDay: 2.1,
  worstDay: -1.3,
  maxDrawdown: -7.5,
};

export const mockExposureByAsset = [
  { asset: 'ETH', percentage: 45 },
  { asset: 'BTC', percentage: 35 },
  { asset: 'SOL', percentage: 15 },
  { asset: 'Other', percentage: 5 },
];

export const mockStrategies = [
  { name: 'Trend-following perps', pnlShare: 45, status: 'Active' as const },
  { name: 'Funding carry', pnlShare: 30, status: 'Active' as const },
  { name: 'Hedging', pnlShare: 15, status: 'Active' as const },
  { name: 'Other', pnlShare: 10, status: 'Experimental' as const },
];

