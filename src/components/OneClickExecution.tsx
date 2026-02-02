/**
 * One-Click Execution Component
 *
 * One-click execution toggle with per-wallet persistence and signature gating.
 * When enabled, requires a one-time wallet signature to authorize.
 * Persists authorization per wallet in localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import { Loader2, Shield, ShieldCheck } from 'lucide-react';

interface OneClickExecutionProps {
  userAddress: string;
  onEnabled?: () => void;
  onDisabled?: () => void;
}

// LocalStorage keys
const getEnabledKey = (address: string) => `blossom_oneclick_${address.toLowerCase()}`;
const getAuthorizedKey = (address: string) => `blossom_oneclick_auth_${address.toLowerCase()}`;
const getSessionIdKey = (address: string) => `blossom_oneclick_sessionid_${address.toLowerCase()}`;

// Authorization message
const getAuthMessage = (address: string) =>
  `Blossom One-Click Execution Authorization\n\nI authorize Blossom to execute transactions on my behalf for this session.\n\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}`;

export default function OneClickExecution({
  userAddress,
  onEnabled,
  onDisabled,
}: OneClickExecutionProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { signMessageAsync } = useSignMessage();

  // Initialize from localStorage on mount and address change
  useEffect(() => {
    if (userAddress) {
      const enabled = localStorage.getItem(getEnabledKey(userAddress)) === 'true';
      const authorized = localStorage.getItem(getAuthorizedKey(userAddress)) === 'true';
      setIsEnabled(enabled);
      setIsAuthorized(authorized);

      // Notify parent of initial state
      if (enabled && authorized) {
        onEnabled?.();
      } else {
        onDisabled?.();
      }
    }
  }, [userAddress]);

  const handleToggle = useCallback(async () => {
    if (!userAddress) return;

    setIsLoading(true);

    try {
      if (!isEnabled) {
        // Enabling: require signature authorization and create session
        const message = getAuthMessage(userAddress);
        const signature = await signMessageAsync({ message });

        if (signature) {
          // Call backend to prepare session (generates sessionId)
          const { callAgent } = await import('../lib/apiClient');
          const response = await callAgent('/api/session/prepare', {
            method: 'POST',
            body: JSON.stringify({ userAddress }),
          });

          if (!response.ok) {
            throw new Error('Failed to prepare session');
          }

          const data = await response.json();

          // Store the generated sessionId for later use
          if (data.session?.sessionId) {
            localStorage.setItem(getSessionIdKey(userAddress), data.session.sessionId);

            if (import.meta.env.DEV) {
              console.log('[OneClickExecution] Stored sessionId:', data.session.sessionId.substring(0, 16) + '...');
            }
          }

          // Store authorization
          localStorage.setItem(getEnabledKey(userAddress), 'true');
          localStorage.setItem(getAuthorizedKey(userAddress), 'true');
          setIsEnabled(true);
          setIsAuthorized(true);
          onEnabled?.();

          if (import.meta.env.DEV) {
            console.log('[OneClickExecution] Authorized and enabled for', userAddress);
          }
        }
      } else {
        // Disabling: clear state
        localStorage.setItem(getEnabledKey(userAddress), 'false');
        localStorage.removeItem(getSessionIdKey(userAddress)); // Clear stored sessionId
        setIsEnabled(false);
        onDisabled?.();

        if (import.meta.env.DEV) {
          console.log('[OneClickExecution] Disabled for', userAddress);
        }
      }
    } catch (error: any) {
      if (import.meta.env.DEV) {
        console.warn('[OneClickExecution] Signature or session creation failed:', error.message);
      }
      // User rejected signature or session creation failed - don't enable
    } finally {
      setIsLoading(false);
    }
  }, [isEnabled, userAddress, signMessageAsync, onEnabled, onDisabled]);

  const isFullyAuthorized = isEnabled && isAuthorized;

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        {isFullyAuthorized ? (
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
        ) : (
          <Shield className="w-3 h-3 text-slate-400" />
        )}
        <span className="text-[10px] font-medium text-slate-600">One-Click</span>
      </div>
      {/* Compact ON/OFF pill button */}
      <button
        onClick={handleToggle}
        disabled={isLoading}
        aria-pressed={isFullyAuthorized}
        className={`
          px-2 py-0.5 text-[9px] font-semibold rounded-full transition-colors
          ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isFullyAuthorized
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
            : 'bg-rose-50 text-rose-600 border border-rose-200'
          }
        `}
      >
        {isLoading ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        ) : isFullyAuthorized ? (
          'ON'
        ) : (
          'OFF'
        )}
      </button>
    </div>
  );
}

// Export helper to check if one-click is authorized
export function isOneClickAuthorized(userAddress: string | null): boolean {
  if (!userAddress) return false;
  const enabled = localStorage.getItem(getEnabledKey(userAddress)) === 'true';
  const authorized = localStorage.getItem(getAuthorizedKey(userAddress)) === 'true';
  return enabled && authorized;
}
