/**
 * One-Click Execution Component
 *
 * Minimal shim for the one-click execution toggle.
 * In production, this would handle session key creation and management.
 */

import { useState } from 'react';

interface OneClickExecutionProps {
  userAddress: string;
  onEnabled?: () => void;
  onDisabled?: () => void;
}

export default function OneClickExecution({
  userAddress,
  onEnabled,
  onDisabled,
}: OneClickExecutionProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    setIsLoading(true);

    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 500));

    const newState = !isEnabled;
    setIsEnabled(newState);
    setIsLoading(false);

    if (newState) {
      onEnabled?.();
    } else {
      onDisabled?.();
    }
  };

  return (
    <div className="bg-slate-50 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-green-500' : 'bg-slate-300'}`} />
          <span className="text-sm font-medium text-slate-700">
            One-Click Execution
          </span>
        </div>
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`
            px-3 py-1 text-xs font-medium rounded-full transition-colors
            ${isEnabled
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
            }
            ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {isLoading ? '...' : isEnabled ? 'Enabled' : 'Enable'}
        </button>
      </div>
      {!isEnabled && (
        <p className="text-xs text-slate-500 mt-2">
          Enable for faster execution without wallet popups
        </p>
      )}
    </div>
  );
}
