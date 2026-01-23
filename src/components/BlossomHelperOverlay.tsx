import { useState } from 'react';

interface BlossomHelperOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function BlossomHelperOverlay({ open, onClose }: BlossomHelperOverlayProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  const handleGotIt = () => {
    if (dontShowAgain && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('blossom_has_seen_helper_v1', 'true');
      } catch (e) {
        // Ignore localStorage errors
      }
    }
    onClose();
  };

  return (
    <div className="absolute top-4 right-4 z-50 w-80 max-w-[calc(100%-2rem)]">
      <div className="rounded-2xl border border-slate-100 bg-white shadow-lg p-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">How Blossom works</h3>
          <button
            type="button"
            onClick={handleGotIt}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <ul className="space-y-2 mb-4">
          <li className="flex items-start gap-2 text-xs text-slate-700">
            <span className="text-slate-400 mt-0.5">1.</span>
            <span>Describe the trade you want in plain English.</span>
          </li>
          <li className="flex items-start gap-2 text-xs text-slate-700">
            <span className="text-slate-400 mt-0.5">2.</span>
            <span>Blossom proposes a strategy with risk, TP/SL, and size.</span>
          </li>
          <li className="flex items-start gap-2 text-xs text-slate-700">
            <span className="text-slate-400 mt-0.5">3.</span>
            <span>You confirm & queue it, then track risk and PnL in the side panels.</span>
          </li>
        </ul>

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-pink-500 focus:ring-pink-200"
            />
            <span className="text-[10px] text-slate-500">Don't show this again</span>
          </label>
          <button
            type="button"
            onClick={handleGotIt}
            className="rounded-full bg-pink-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-pink-600 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}







