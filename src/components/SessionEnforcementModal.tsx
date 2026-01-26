/**
 * Session Enforcement Modal
 *
 * Blocking modal that requires user to enable One-Click Session mode
 * before using the app. Appears after access gate is unlocked.
 */

import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Loader2, Shield, ShieldCheck, Zap, Info } from 'lucide-react';
import { BlossomLogo } from './BlossomLogo';
import { Button } from './ui/Button';

// LocalStorage keys (matching OneClickExecution.tsx)
const getEnabledKey = (address: string) => `blossom_oneclick_${address.toLowerCase()}`;
const getAuthorizedKey = (address: string) => `blossom_oneclick_auth_${address.toLowerCase()}`;
const SESSION_REQUIRED_KEY = 'blossom_session_required_dismissed';

// Authorization message
const getAuthMessage = (address: string) =>
  `Blossom One-Click Execution Authorization\n\nI authorize Blossom to execute transactions on my behalf for this session.\n\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}`;

interface SessionEnforcementModalProps {
  onSessionEnabled: () => void;
}

export function isSessionEnabled(address: string | undefined): boolean {
  if (!address) return false;
  const enabled = localStorage.getItem(getEnabledKey(address)) === 'true';
  const authorized = localStorage.getItem(getAuthorizedKey(address)) === 'true';
  return enabled && authorized;
}

export default function SessionEnforcementModal({ onSessionEnabled }: SessionEnforcementModalProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLearnMore, setShowLearnMore] = useState(false);

  // Check if already authorized
  useEffect(() => {
    if (address && isSessionEnabled(address)) {
      onSessionEnabled();
    }
  }, [address, onSessionEnabled]);

  const handleEnableSession = async () => {
    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const message = getAuthMessage(address);
      const signature = await signMessageAsync({ message });

      if (signature) {
        // Store authorization
        localStorage.setItem(getEnabledKey(address), 'true');
        localStorage.setItem(getAuthorizedKey(address), 'true');

        console.log('[SessionEnforcement] Session enabled for', address);
        onSessionEnabled();
      }
    } catch (err: any) {
      console.warn('[SessionEnforcement] Signature failed:', err.message);
      setError('Signature rejected. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Don't show if wallet not connected
  if (!isConnected) {
    return null;
  }

  // Already enabled
  if (address && isSessionEnabled(address)) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />

      {/* Modal card */}
      <div className="relative z-10 mx-4 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
        <div className="rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-pink-100 to-pink-50">
              <Zap className="h-7 w-7 text-pink-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900">
              Enable One-Click Session
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              For seamless execution, enable session mode with a one-time signature.
            </p>
          </div>

          {/* Benefits list */}
          <div className="px-6 py-3 bg-slate-50 border-y border-slate-100">
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Execute trades without confirming each transaction</span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>Your keys stay secure - only signs a permission message</span>
              </li>
              <li className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>Faster execution for time-sensitive opportunities</span>
              </li>
            </ul>
          </div>

          {/* Learn more expandable */}
          {showLearnMore && (
            <div className="px-6 py-3 bg-blue-50 border-b border-slate-100">
              <p className="text-xs text-blue-700">
                One-Click Session mode allows Blossom to submit transactions on your behalf
                without requiring individual confirmations. You maintain full control and can
                disable this at any time. Your private keys are never shared - you only sign
                a permission message that authorizes this session.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="px-6 py-2 bg-red-50 border-b border-red-100">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 py-4 space-y-3">
            <Button
              onClick={handleEnableSession}
              disabled={isLoading}
              className="w-full h-11 bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white font-medium rounded-xl"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Waiting for signature...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Enable Session
                </>
              )}
            </Button>

            <button
              onClick={() => setShowLearnMore(!showLearnMore)}
              className="w-full text-sm text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1"
            >
              <Info className="h-3.5 w-3.5" />
              {showLearnMore ? 'Hide details' : 'Learn more'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
