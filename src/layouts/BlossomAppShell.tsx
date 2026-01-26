import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { ToastProvider } from '../components/toast/ToastProvider';
import CopilotLayout from '../components/CopilotLayout';
import AccessGateOverlay from '../components/AccessGateOverlay';
import SessionEnforcementModal, { isSessionEnabled } from '../components/SessionEnforcementModal';
import { useAccessGate } from '../hooks/useAccessGate';

export default function BlossomAppShell() {
  const { isAuthorized, isLoading, grantAccess } = useAccessGate();
  const { address, isConnected } = useAccount();
  const [sessionEnabled, setSessionEnabled] = useState(() => {
    // Check initial session state
    return address ? isSessionEnabled(address) : false;
  });

  const handleSessionEnabled = useCallback(() => {
    setSessionEnabled(true);
  }, []);

  // Determine if session modal should show
  // Only show after access gate is unlocked AND wallet is connected AND session not enabled
  const showSessionModal = isAuthorized && isConnected && !sessionEnabled;

  return (
    <div className="h-[100dvh] h-screen w-screen overflow-hidden bg-slate-50">
      {/* Stable subtle blossom bloom gradient - does not change on tab switch */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.16]">
        <div className="absolute -top-40 left-[-10%] h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,#FFC0E4,transparent)]" />
      </div>
      <div className="relative z-10 h-full w-full">
        <ToastProvider>
          <CopilotLayout />
        </ToastProvider>
      </div>

      {/* Show access gate overlay if not authorized (and not loading) */}
      {!isLoading && !isAuthorized && (
        <AccessGateOverlay onAccessGranted={grantAccess} />
      )}

      {/* Show session enforcement modal after access gate is unlocked */}
      {showSessionModal && (
        <SessionEnforcementModal onSessionEnabled={handleSessionEnabled} />
      )}
    </div>
  );
}

