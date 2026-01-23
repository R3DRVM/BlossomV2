import { useState, useEffect } from 'react';
import { ToastProvider } from '../components/toast/ToastProvider';
import CopilotLayout from '../components/CopilotLayout';
import AccessGate from '../components/AccessGate';
import { callAgent } from '../lib/apiClient';
import { getAddress } from '../lib/walletAdapter';

export default function BlossomAppShell() {
  const accessGateEnabled = import.meta.env.VITE_ACCESS_GATE_ENABLED === "true";
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    // If access gate is disabled, grant access immediately
    if (!accessGateEnabled) {
      setHasAccess(true);
      return;
    }

    // Check if user already has access
    const checkAccess = async () => {
      // Check localStorage first
      const storedCode = localStorage.getItem('blossom_access_code');
      const storedWallet = localStorage.getItem('blossom_access_wallet');
      
      if (!storedCode) {
        setHasAccess(false);
        return;
      }

      // Validate with backend
      try {
        let walletAddress: string | undefined;
        try {
          const addr = await getAddress();
          walletAddress = addr ?? undefined; // Convert null to undefined
        } catch {
          // Wallet not connected - that's ok
        }

        const response = await callAgent('/api/access/check', {
          method: 'POST',
          body: JSON.stringify({
            code: storedCode,
            walletAddress: walletAddress || storedWallet || undefined,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setHasAccess(data.hasAccess || false);
        } else {
          setHasAccess(false);
        }
      } catch {
        setHasAccess(false);
      }
    };

    checkAccess();
  }, [accessGateEnabled]);

  if (hasAccess === null) {
    // Loading state
    return (
      <div className="h-[100dvh] h-screen w-screen overflow-hidden bg-slate-50 flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!hasAccess) {
    return <AccessGate onAccessGranted={() => setHasAccess(true)} />;
  }

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
    </div>
  );
}

