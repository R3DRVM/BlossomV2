/**
 * Access Gate Component
 *
 * Minimal shim that auto-grants access in development.
 * In production, this would handle invite codes, waitlist, etc.
 */

import { useEffect } from 'react';

interface AccessGateProps {
  onAccessGranted: () => void;
}

export default function AccessGate({ onAccessGranted }: AccessGateProps) {
  // Auto-grant access in development
  useEffect(() => {
    // Small delay to avoid flash
    const timer = setTimeout(() => {
      onAccessGranted();
    }, 100);
    return () => clearTimeout(timer);
  }, [onAccessGranted]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-slate-600">Loading...</p>
      </div>
    </div>
  );
}
