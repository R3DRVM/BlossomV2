/**
 * One-Click Execution Component
 *
 * One-click execution toggle with per-wallet persistence and signature gating.
 * When enabled, requires a one-time wallet signature to authorize.
 * Persists authorization per wallet in localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Shield, ShieldCheck } from 'lucide-react';
import { callAgent } from '../lib/apiClient';
import { sendTransaction } from '../lib/walletAdapter';

interface OneClickExecutionProps {
  userAddress: string;
  onEnabled?: () => void;
  onDisabled?: () => void;
}

// LocalStorage keys
const getEnabledKey = (address: string) => `blossom_oneclick_${address.toLowerCase()}`;
const getAuthorizedKey = (address: string) => `blossom_oneclick_auth_${address.toLowerCase()}`;
const getSessionIdKey = (address: string) => `blossom_oneclick_sessionid_${address.toLowerCase()}`;
const getLegacySessionIdKey = (address: string) => `blossom_session_${address.toLowerCase()}`;

export default function OneClickExecution({
  userAddress,
  onEnabled,
  onDisabled,
}: OneClickExecutionProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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

  // Validate stored session AND token approval with server on restore
  useEffect(() => {
    if (userAddress && isEnabled && isAuthorized) {
      const storedSessionId = localStorage.getItem(getSessionIdKey(userAddress));
      if (storedSessionId) {
        callAgent('/api/session/validate-complete', {
          method: 'POST',
          body: JSON.stringify({ userAddress, sessionId: storedSessionId }),
        })
          .then(res => res.json())
          .then(data => {
            // Check session validity
            if (!data.sessionValid) {
              console.warn('[OneClickExecution] Session validation failed:', data.sessionReason);
              localStorage.removeItem(getEnabledKey(userAddress));
              localStorage.removeItem(getAuthorizedKey(userAddress));
              localStorage.removeItem(getSessionIdKey(userAddress));
              setIsEnabled(false);
              setIsAuthorized(false);
              onDisabled?.();
              return;
            }

            // Check approval validity - if missing, clear auth flag to trigger re-approval
            if (!data.approvalValid) {
              console.warn('[OneClickExecution] Token approval expired or missing');
              // Keep session but clear authorization to force re-approval flow
              localStorage.removeItem(getAuthorizedKey(userAddress));
              setIsAuthorized(false);
              onDisabled?.();
            }
          })
          .catch(err => {
            // Keep existing state if validation fails (network error)
            console.warn('[OneClickExecution] Validation request failed:', err);
          });
      }
    }
  }, [userAddress, isEnabled, isAuthorized, onDisabled]);

  const handleToggle = useCallback(async () => {
    if (!userAddress) return;

    setIsLoading(true);

    try {
      if (!isEnabled) {
        // Enabling: create on-chain session (single wallet signature)
        const response = await callAgent('/api/session/prepare', {
          method: 'POST',
          body: JSON.stringify({ userAddress }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData?.error?.message || errorData?.error || 'Failed to prepare session');
        }

        const data = await response.json();
        const sessionId = data?.session?.sessionId;
        const txTo = data?.session?.to;
        const txData = data?.session?.data;
        const txValue = data?.session?.value || '0x0';

        if (!sessionId || !txTo || !txData) {
          throw new Error('Session preparation returned invalid transaction data');
        }

        const txHash = await sendTransaction({
          to: txTo,
          data: txData,
          value: txValue,
        });

        if (!txHash) {
          throw new Error('Session creation transaction was rejected');
        }

        // Wait for confirmation (up to ~60s)
        let confirmed = false;
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const statusResponse = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(txHash)}`, {
              method: 'GET',
            });
            if (!statusResponse.ok) continue;
            const statusData = await statusResponse.json();
            const status = String(statusData?.status || '').toLowerCase();
            if (status === 'confirmed') {
              confirmed = true;
              break;
            }
            if (status === 'reverted' || status === 'failed') {
              throw new Error('Session creation transaction reverted');
            }
          } catch {
            // keep polling
          }
        }

        if (!confirmed) {
          throw new Error('Session creation is still pending. Please retry in a few seconds.');
        }

        // Store the generated sessionId for later use
        localStorage.setItem(getSessionIdKey(userAddress), sessionId);
        localStorage.setItem(getLegacySessionIdKey(userAddress), sessionId);

        // Store authorization flags
        localStorage.setItem(getEnabledKey(userAddress), 'true');
        localStorage.setItem(getAuthorizedKey(userAddress), 'true');
        setIsEnabled(true);
        setIsAuthorized(true);
        onEnabled?.();

        if (import.meta.env.DEV) {
          console.log('[OneClickExecution] Session created and enabled for', userAddress, sessionId.substring(0, 16) + '...');
        }
      } else {
        // Disabling: clear state
        localStorage.setItem(getEnabledKey(userAddress), 'false');
        localStorage.setItem(getAuthorizedKey(userAddress), 'false');
        localStorage.removeItem(getSessionIdKey(userAddress)); // Clear stored sessionId
        localStorage.removeItem(getLegacySessionIdKey(userAddress)); // Clear legacy stored sessionId
        setIsEnabled(false);
        setIsAuthorized(false);
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
  }, [isEnabled, userAddress, onEnabled, onDisabled]);

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
