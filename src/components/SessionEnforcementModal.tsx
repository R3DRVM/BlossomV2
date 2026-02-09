/**
 * Session Enforcement Modal
 *
 * Blocking modal that requires user to enable One-Click Session mode
 * before using the app. Appears after access gate is unlocked.
 */

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Loader2, Shield, ShieldCheck, Zap, Info } from 'lucide-react';
import { BlossomLogo } from './BlossomLogo';
import { Button } from './ui/Button';
import { callAgent } from '../lib/apiClient';
import { sendTransaction } from '../lib/walletAdapter';

// LocalStorage keys (matching OneClickExecution.tsx)
const getEnabledKey = (address: string) => `blossom_oneclick_${address.toLowerCase()}`;
const getAuthorizedKey = (address: string) => `blossom_oneclick_auth_${address.toLowerCase()}`;
const getManualSigningKey = (address: string) => `blossom_manual_signing_${address.toLowerCase()}`;
const SESSION_REQUIRED_KEY = 'blossom_session_required_dismissed';

interface SessionEnforcementModalProps {
  onSessionEnabled: () => void;
}

export function isSessionEnabled(address: string | undefined): boolean {
  if (!address) return false;
  const enabled = localStorage.getItem(getEnabledKey(address)) === 'true';
  const authorized = localStorage.getItem(getAuthorizedKey(address)) === 'true';
  return enabled && authorized;
}

export function isManualSigningEnabled(address: string | undefined): boolean {
  if (!address) return false;
  return localStorage.getItem(getManualSigningKey(address)) === 'true';
}

export function hasUserChosenSigningMode(address: string | undefined): boolean {
  if (!address) return false;
  return isSessionEnabled(address) || isManualSigningEnabled(address);
}

export default function SessionEnforcementModal({ onSessionEnabled }: SessionEnforcementModalProps) {
  const { address, isConnected } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [approvalStep, setApprovalStep] = useState<'session' | 'token' | 'mint' | 'complete'>('session');

  // Check if already authorized (session or manual signing)
  useEffect(() => {
    if (address && hasUserChosenSigningMode(address)) {
      onSessionEnabled();
    }
  }, [address, onSessionEnabled]);

  const handleManualSigning = () => {
    if (!address) {
      setError('Please connect your wallet first');
      return;
    }
    // Persist manual signing preference
    localStorage.setItem(getManualSigningKey(address), 'true');
    console.log('[SessionEnforcement] Manual signing enabled for', address);
    onSessionEnabled();
  };

  const handleEnableSession = async () => {
    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await callAgent('/api/session/prepare', {
        method: 'POST',
        body: JSON.stringify({ userAddress: address }),
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

      // Session created successfully - now check for token approval
      console.log('[SessionEnforcement] Session created, checking token approval...');
      setApprovalStep('token');
      setIsLoading(false);

      // Check if token approval is needed
      const approvalResponse = await callAgent('/api/setup/check-approval', {
        method: 'POST',
        body: JSON.stringify({ userAddress: address }),
      });

      if (!approvalResponse.ok) {
        // If check fails, proceed anyway (maybe approval endpoint doesn't exist)
        console.warn('[SessionEnforcement] Could not check approval status, proceeding...');
        finalizeSessionSetup(address, sessionId);
        return;
      }

      const approvalData = await approvalResponse.json();
      const hasApproval = approvalData?.hasApproval ?? false;

      if (hasApproval) {
        // Already approved, complete setup
        console.log('[SessionEnforcement] Token already approved');
        finalizeSessionSetup(address, sessionId);
        return;
      }

      // Need token approval - prepare approval transaction
      console.log('[SessionEnforcement] Token approval needed');
      setIsLoading(true);

      const prepareApprovalResponse = await callAgent('/api/setup/approve', {
        method: 'POST',
        body: JSON.stringify({
          userAddress: address,
          tokenAddress: approvalData.tokenAddress,
          spenderAddress: approvalData.spenderAddress,
          amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935', // max uint256
        }),
      });

      if (!prepareApprovalResponse.ok) {
        throw new Error('Failed to prepare token approval');
      }

      const approvalTxData = await prepareApprovalResponse.json();
      const approvalTxHash = await sendTransaction({
        to: approvalTxData.to,
        data: approvalTxData.data,
        value: '0x0',
      });

      if (!approvalTxHash) {
        throw new Error('Token approval transaction was rejected');
      }

      // Wait for approval confirmation
      let approvalConfirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const statusResponse = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(approvalTxHash)}`, {
            method: 'GET',
          });
          if (!statusResponse.ok) continue;
          const statusData = await statusResponse.json();
          const status = String(statusData?.status || '').toLowerCase();
          if (status === 'confirmed') {
            approvalConfirmed = true;
            break;
          }
          if (status === 'reverted' || status === 'failed') {
            throw new Error('Token approval transaction reverted');
          }
        } catch {
          // keep polling
        }
      }

      if (!approvalConfirmed) {
        throw new Error('Token approval is still pending. Your session is ready but you may need to approve tokens manually.');
      }

      // Both session and approval complete - now check balance
      await checkAndMintIfNeeded(address, sessionId);
    } catch (err: any) {
      console.warn('[SessionEnforcement] Session setup failed:', err.message);
      setError(err.message || 'Session setup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const checkAndMintIfNeeded = async (addr: string, sessionId: string) => {
    try {
      console.log('[SessionEnforcement] Checking balance...');
      setIsLoading(true);

      // Check balance
      const balanceResponse = await callAgent('/api/setup/check-balance', {
        method: 'POST',
        body: JSON.stringify({ userAddress: addr }),
      });

      if (!balanceResponse.ok) {
        console.warn('[SessionEnforcement] Balance check failed, proceeding anyway');
        finalizeSessionSetup(addr, sessionId);
        return;
      }

      const balanceData = await balanceResponse.json();
      const hasBalance = balanceData?.hasBalance ?? false;

      if (hasBalance) {
        // User has tokens, complete setup
        console.log('[SessionEnforcement] User has balance, setup complete');
        finalizeSessionSetup(addr, sessionId);
        return;
      }

      // No balance - offer to mint
      console.log('[SessionEnforcement] No balance, offering mint...');
      setApprovalStep('mint');
      setIsLoading(false);
    } catch (error: any) {
      console.warn('[SessionEnforcement] Balance check error:', error);
      // On error, just complete setup
      finalizeSessionSetup(addr, sessionId);
    }
  };

  const handleMintTokens = async () => {
    if (!address) return;

    setIsLoading(true);
    setError('');

    try {
      console.log('[SessionEnforcement] Minting tokens...');

      // Mint tokens (backend will auto-detect chain)
      const mintResponse = await callAgent('/api/mint-busdc', {
        method: 'POST',
        body: JSON.stringify({
          userAddress: address,
          amount: 1000, // Default 1000 bUSDC
          chain: 'ethereum', // Default to ethereum, can be made dynamic
        }),
      });

      if (!mintResponse.ok) {
        const errorData = await mintResponse.json().catch(() => ({}));
        throw new Error(errorData?.error || 'Failed to mint tokens');
      }

      const mintData = await mintResponse.json();
      console.log('[SessionEnforcement] Mint successful:', mintData);

      // Retrieve sessionId from localStorage
      const sessionId = localStorage.getItem(`blossom_oneclick_sessionid_${address.toLowerCase()}`) || '';
      finalizeSessionSetup(address, sessionId);
    } catch (error: any) {
      console.error('[SessionEnforcement] Mint failed:', error);
      setError(error.message || 'Failed to mint tokens. You can skip this step and add tokens manually later.');
      setIsLoading(false);
    }
  };

  const handleSkipMint = () => {
    if (!address) return;
    const sessionId = localStorage.getItem(`blossom_oneclick_sessionid_${address.toLowerCase()}`) || '';
    console.log('[SessionEnforcement] User skipped mint');
    finalizeSessionSetup(address, sessionId);
  };

  const finalizeSessionSetup = (addr: string, sessionId: string) => {
    // Store authorization + sessionId (match OneClickExecution.tsx)
    localStorage.setItem(getEnabledKey(addr), 'true');
    localStorage.setItem(getAuthorizedKey(addr), 'true');
    localStorage.setItem(`blossom_oneclick_sessionid_${addr.toLowerCase()}`, sessionId);
    localStorage.setItem(`blossom_session_${addr.toLowerCase()}`, sessionId);

    console.log('[SessionEnforcement] Full setup complete for', addr);
    setApprovalStep('complete');
    onSessionEnabled();
  };

  // Don't show if wallet not connected
  if (!isConnected) {
    return null;
  }

  // Already enabled (session or manual signing)
  if (address && hasUserChosenSigningMode(address)) {
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
              {approvalStep === 'session' && 'Enable One-Click Session'}
              {approvalStep === 'token' && 'Approve Token Spending'}
              {approvalStep === 'mint' && 'Get Test Tokens'}
              {approvalStep === 'complete' && 'Setup Complete!'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {approvalStep === 'session' && 'For seamless execution, enable session mode with a one-time approval transaction.'}
              {approvalStep === 'token' && 'One more step: approve the router to spend your tokens for automated execution.'}
              {approvalStep === 'mint' && 'Your wallet needs test tokens to start trading. Get 1,000 bUSDC for free!'}
              {approvalStep === 'complete' && 'Your account is ready for one-click execution!'}
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
                <span>Your keys stay secure — one-time approval, no repeated prompts</span>
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
                disable this at any time. Your private keys are never shared — you approve a
                single on-chain session and Blossom relays trades within that session.
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
              onClick={approvalStep === 'mint' ? handleMintTokens : handleEnableSession}
              disabled={isLoading || approvalStep === 'complete'}
              className="w-full h-11 bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white font-medium rounded-xl disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {approvalStep === 'session' && 'Creating session...'}
                  {approvalStep === 'token' && 'Approving tokens...'}
                  {approvalStep === 'mint' && 'Minting tokens...'}
                </>
              ) : approvalStep === 'complete' ? (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Setup Complete
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  {approvalStep === 'session' && 'Enable Session'}
                  {approvalStep === 'token' && 'Approve Tokens'}
                  {approvalStep === 'mint' && 'Get 1,000 bUSDC'}
                </>
              )}
            </Button>

            {/* Skip mint option */}
            {approvalStep === 'mint' && !isLoading && (
              <button
                onClick={handleSkipMint}
                className="w-full h-10 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors"
              >
                Skip — I'll add tokens later
              </button>
            )}

            {/* Manual Signing Option */}
            <button
              onClick={handleManualSigning}
              className="w-full h-10 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors"
            >
              No — I want to sign every transaction
            </button>

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
