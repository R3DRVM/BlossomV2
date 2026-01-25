/**
 * Website Lock Overlay
 * Lightweight password gate for production deployment (blossomv2.fly.dev)
 */

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'BLOSSOM_GATE_UNLOCKED';
const EXPIRY_DAYS = 7;
const PASSWORD = 'bloom'; // case-insensitive

// Hosts where gate should be enabled
const GATED_HOSTS = new Set([
  'blossomv2.fly.dev',
]);

interface WebsiteLockProps {
  children: React.ReactNode;
}

export default function WebsiteLock({ children }: WebsiteLockProps) {
  const [isLocked, setIsLocked] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Compute gate enabled status once at mount
  const gateEnabled = (() => {
    // Check env var first (allows override)
    const envEnabled = import.meta.env.VITE_GATE_ENABLED;
    if (envEnabled === 'true') return true;
    if (envEnabled === 'false') return false;

    // Default: enable only on hosts in allowlist
    return GATED_HOSTS.has(window.location.hostname);
  })();

  // Check if already unlocked
  const checkUnlockStatus = () => {
    if (!gateEnabled) {
      setIsLocked(false);
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setIsLocked(true);
        return;
      }

      const data = JSON.parse(stored);
      const now = Date.now();
      
      if (data.expiry && now < data.expiry) {
        setIsLocked(false);
      } else {
        // Expired, clear and lock
        localStorage.removeItem(STORAGE_KEY);
        setIsLocked(true);
      }
    } catch {
      setIsLocked(true);
    }
  };

  useEffect(() => {
    checkUnlockStatus();

    // Listen for Cmd+Shift+L (Mac) or Ctrl+Shift+L (Windows/Linux) to re-lock
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        localStorage.removeItem(STORAGE_KEY);
        setIsLocked(true);
        setPassword('');
        setError(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Prevent scrolling when locked
  useEffect(() => {
    if (isLocked) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isLocked]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const enteredPassword = password.trim().toLowerCase();
    if (enteredPassword === PASSWORD.toLowerCase()) {
      // Set unlock with expiry
      const expiry = Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ expiry }));
      setIsLocked(false);
      setPassword('');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  // Gate disabled - render children normally
  if (!gateEnabled) {
    return <>{children}</>;
  }

  // Gate enabled - show overlay immediately if checking (prevent flash) or if locked
  const shouldShowOverlay = isLocked === null || isLocked;

  if (!shouldShowOverlay) {
    // Gate enabled but unlocked
    return <>{children}</>;
  }

  // Gate enabled and (checking or locked) - show overlay
  return (
    <>
      {/* Render children normally (animations visible behind overlay) */}
      {children}
      
      {/* Blurred overlay - blocks interaction, content visible but unreadable */}
      <div className="fixed inset-0 z-[10001] bg-slate-900/60 backdrop-blur-md pointer-events-auto">
        {/* Lock card */}
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200/50 p-8 space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="text-2xl font-bold text-slate-900" style={{
                fontFamily: '"Playfair Display", Georgia, serif',
              }}>
                Private Preview
              </div>
              <div className="text-sm text-slate-600">
                Enter password to continue
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Password"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blossom-pink focus:border-transparent text-center"
                  autoFocus
                  autoComplete="off"
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!password.trim()}
                className="w-full py-3 bg-blossom-pink text-white rounded-xl font-medium hover:bg-blossom-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enter
              </button>
            </form>

            {/* Dev hint */}
            <div className="text-xs text-slate-500 text-center pt-2 border-t border-slate-200">
              Press Cmd+Shift+L (Mac) or Ctrl+Shift+L to re-lock
            </div>
          </div>
        </div>
      </div>
    </>
  );
}