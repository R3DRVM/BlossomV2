import { AccountState, Strategy, DefiPosition } from '../../context/BlossomContext';
import { computeExposureByAsset } from '../../lib/portfolioComputed';

interface CorrelationMatrixProps {
  account: AccountState;
  strategies: Strategy[];
  defiPositions: DefiPosition[];
}

/**
 * Compute correlation between two assets using proxy rules
 */
function computeCorrelation(asset1: string, asset2: string): number {
  if (asset1 === asset2) return 1.0;

  const majors = ['BTC', 'ETH'];
  const stables = ['REDACTED', 'USDT', 'DAI'];

  const isMajor1 = majors.includes(asset1);
  const isMajor2 = majors.includes(asset2);
  const isStable1 = stables.includes(asset1);
  const isStable2 = stables.includes(asset2);

  // Stables vs others
  if ((isStable1 && !isStable2) || (isStable2 && !isStable1)) return 0.1;

  // Both majors
  if (isMajor1 && isMajor2) return 0.7;

  // One major, one alt
  if ((isMajor1 && !isMajor2) || (isMajor2 && !isMajor1)) return 0.4;

  // Both alts
  return 0.5;
}

export default function CorrelationMatrix({ account, strategies, defiPositions }: CorrelationMatrixProps) {
  const exposureByAsset = computeExposureByAsset(account, strategies, defiPositions);

  // Get top assets by exposure (excluding cash/spot)
  const topAssets = exposureByAsset
    .filter(item => !item.asset.includes('REDACTED') && !item.asset.includes('Spot'))
    .slice(0, 8)
    .map(item => {
      // Extract base asset name from label
      const assetName = item.asset.split(' ')[0]; // "Perps" -> "Perps", "ETH-PERP" -> "ETH"
      return {
        name: assetName,
        percentage: item.percentage,
      };
    });

  if (topAssets.length < 2) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Correlation Matrix</h3>
        <p className="text-xs text-gray-500">Not enough positions to compute correlations</p>
      </div>
    );
  }

  // Build correlation matrix
  const matrix = topAssets.map(asset1 =>
    topAssets.map(asset2 => computeCorrelation(asset1.name, asset2.name))
  );

  const getCorrelationColor = (value: number): string => {
    if (value >= 0.7) return 'bg-red-100 text-red-700';
    if (value >= 0.4) return 'bg-yellow-100 text-yellow-700';
    if (value >= 0.1) return 'bg-green-100 text-green-700';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Correlation Matrix</h3>
      <p className="text-xs text-gray-500 mb-4">Cross-asset correlation estimates (proxy values)</p>
      
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Header row */}
          <div className="flex border-b border-gray-200 pb-2 mb-2">
            <div className="w-20 flex-shrink-0"></div>
            {topAssets.map((asset, idx) => (
              <div
                key={idx}
                className="w-16 flex-shrink-0 text-center text-[10px] font-medium text-gray-600 truncate"
                title={asset.name}
              >
                {asset.name}
              </div>
            ))}
          </div>

          {/* Matrix rows */}
          {topAssets.map((asset1, rowIdx) => (
            <div key={rowIdx} className="flex items-center border-b border-gray-100 last:border-0 py-1.5">
              <div className="w-20 flex-shrink-0 text-[10px] font-medium text-gray-700 truncate" title={asset1.name}>
                {asset1.name}
              </div>
              {topAssets.map((asset2, colIdx) => {
                const value = matrix[rowIdx][colIdx];
                const isDiagonal = rowIdx === colIdx;
                return (
                  <div
                    key={colIdx}
                    className={`w-16 flex-shrink-0 text-center text-[10px] font-medium rounded px-1 py-0.5 mx-0.5 ${
                      isDiagonal ? 'bg-slate-200 text-slate-700' : getCorrelationColor(value)
                    }`}
                    title={`${asset1.name} ↔ ${asset2.name}: ${value.toFixed(2)}`}
                  >
                    {value.toFixed(2)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-4 text-[10px] text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-red-100"></span>
          <span>High (≥0.7)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-yellow-100"></span>
          <span>Medium (0.4-0.7)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-green-100"></span>
          <span>Low (0.1-0.4)</span>
        </div>
      </div>
    </div>
  );
}

