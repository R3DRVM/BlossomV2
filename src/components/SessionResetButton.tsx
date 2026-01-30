/**
 * Session Reset Button
 *
 * Explicit UI control to clear chat + reset session.
 * Clears chat history and regenerates anon identity.
 */

import { useState } from 'react';
import { Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { resetSession } from '../lib/executionGuard';

interface SessionResetButtonProps {
  onReset?: () => void;
  className?: string;
  variant?: 'button' | 'link' | 'icon';
}

export default function SessionResetButton({
  onReset,
  className = '',
  variant = 'button',
}: SessionResetButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (!confirming) {
      setConfirming(true);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirming(false), 3000);
      return;
    }

    setResetting(true);

    // Reset session
    resetSession();

    // Small delay for UX
    await new Promise((r) => setTimeout(r, 300));

    setResetting(false);
    setConfirming(false);

    // Notify parent
    if (onReset) {
      onReset();
    } else {
      // Reload page to apply changes
      window.location.reload();
    }
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleReset}
        disabled={resetting}
        className={`p-2 text-slate-400 hover:text-red-500 transition-colors rounded ${className}`}
        title={confirming ? 'Click again to confirm' : 'Clear chat & reset session'}
      >
        {resetting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : confirming ? (
          <RefreshCw className="w-4 h-4 text-red-500" />
        ) : (
          <Trash2 className="w-4 h-4" />
        )}
      </button>
    );
  }

  if (variant === 'link') {
    return (
      <button
        onClick={handleReset}
        disabled={resetting}
        className={`text-sm text-slate-500 hover:text-red-500 transition-colors ${className}`}
      >
        {resetting ? (
          'Resetting...'
        ) : confirming ? (
          <span className="text-red-500">Click to confirm reset</span>
        ) : (
          'Clear chat & reset session'
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleReset}
      disabled={resetting}
      className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
        confirming
          ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
      } ${className}`}
    >
      {resetting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Resetting...
        </>
      ) : confirming ? (
        <>
          <RefreshCw className="w-4 h-4" />
          Click to confirm
        </>
      ) : (
        <>
          <Trash2 className="w-4 h-4" />
          Clear chat & reset
        </>
      )}
    </button>
  );
}
