/**
 * Early Beta Access Gate Overlay
 * Blocks app access until user provides valid access code or joins waitlist
 */

import { useState, useEffect } from 'react';
import { BlossomLogo } from './BlossomLogo';
import { Button } from './ui/Button';
import { ChevronDown, ChevronUp, Mail, Loader2, Check, AlertCircle, Unlock } from 'lucide-react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';

interface AccessGateOverlayProps {
  onAccessGranted: () => void;
}

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export default function AccessGateOverlay({ onAccessGranted }: AccessGateOverlayProps) {
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [email, setEmail] = useState('');
  const [telegramHandle, setTelegramHandle] = useState('');
  const [twitterHandle, setTwitterHandle] = useState('');

  const [codeSubmitState, setCodeSubmitState] = useState<SubmitState>('idle');
  const [waitlistSubmitState, setWaitlistSubmitState] = useState<SubmitState>('idle');

  const [codeError, setCodeError] = useState('');
  const [waitlistError, setWaitlistError] = useState('');

  const [isVisible, setIsVisible] = useState(true);

  // Check for existing gate pass on mount
  useEffect(() => {
    checkGatePass();
  }, []);

  async function checkGatePass() {
    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/access/status`, {
        credentials: 'include', // Include cookies
      });

      const data = await response.json();

      if (data.ok && data.authorized) {
        // Already authorized, grant access immediately
        onAccessGranted();
      }
    } catch (error) {
      // If check fails, show gate (fail-closed)
      console.log('[AccessGate] Status check failed, showing gate');
    }
  }

  async function handleAccessCodeSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!accessCode.trim()) {
      setCodeError('Please enter an access code');
      return;
    }

    setCodeSubmitState('loading');
    setCodeError('');

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/access/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for session
        body: JSON.stringify({ code: accessCode.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (data.ok && data.authorized) {
        // Success! Access granted
        setCodeSubmitState('success');

        // Animate out and grant access
        setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => {
            onAccessGranted();
          }, 300); // Wait for fade-out animation
        }, 500);
      } else {
        setCodeSubmitState('error');
        setCodeError(data.error || 'Invalid access code');
      }
    } catch (error: any) {
      setCodeSubmitState('error');
      setCodeError('Failed to verify code. Please try again.');
    }
  }

  async function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim()) {
      setWaitlistError('Please enter an email address');
      return;
    }

    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) {
      setWaitlistError('Please enter a valid email address');
      return;
    }

    setWaitlistSubmitState('loading');
    setWaitlistError('');

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          telegramHandle: telegramHandle.trim() || undefined,
          twitterHandle: twitterHandle.trim() || undefined,
          source: 'app_gate',
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setWaitlistSubmitState('success');
        // Keep gate locked but show success message
      } else {
        setWaitlistSubmitState('error');
        setWaitlistError(data.error || 'Failed to join waitlist');
      }
    } catch (error) {
      setWaitlistSubmitState('error');
      setWaitlistError('Failed to join waitlist. Please try again.');
    }
  }

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[9999] transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ backdropFilter: 'blur(12px)' }}
    >
      {/* Blurred background overlay */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Centered gate card */}
      <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
        <div className="relative w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 text-center border-b border-gray-100">
              <div className="flex justify-center mb-4">
                <BlossomLogo size={48} className="drop-shadow-sm" />
              </div>
              <h1
                className="text-2xl font-bold text-gray-900 mb-2"
                style={{ fontFamily: '"Playfair Display", serif' }}
              >
                Blossom Early Beta
              </h1>
              <p className="text-gray-600 text-sm">
                Enter an access code or join the waitlist to get access
              </p>
            </div>

            {/* Content */}
            <div className="px-8 py-6 space-y-6">
              {/* Waitlist Success State */}
              {waitlistSubmitState === 'success' && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-900">You're on the list!</p>
                    <p className="text-sm text-green-700 mt-1">
                      We'll email you when your access is ready.
                    </p>
                  </div>
                </div>
              )}

              {/* Waitlist Form */}
              {waitlistSubmitState !== 'success' && (
                <form onSubmit={handleWaitlistSubmit}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Join the Waitlist
                      </label>

                      {/* Email */}
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                        disabled={waitlistSubmitState === 'loading'}
                      />
                    </div>

                    {/* Optional handles */}
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={telegramHandle}
                        onChange={(e) => setTelegramHandle(e.target.value)}
                        placeholder="Telegram handle (optional)"
                        className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                        disabled={waitlistSubmitState === 'loading'}
                      />
                      <input
                        type="text"
                        value={twitterHandle}
                        onChange={(e) => setTwitterHandle(e.target.value)}
                        placeholder="Twitter handle (optional)"
                        className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                        disabled={waitlistSubmitState === 'loading'}
                      />
                    </div>

                    {/* Error message */}
                    {waitlistError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-red-600">{waitlistError}</p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={waitlistSubmitState === 'loading' || !email.trim()}
                    >
                      {waitlistSubmitState === 'loading' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Joining...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Join Waitlist
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}

              {/* Access Code Section */}
              <div className="pt-6 border-t border-gray-100">
                <button
                  onClick={() => setShowAccessCode(!showAccessCode)}
                  className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-[#F25AA2] transition-colors"
                >
                  <Unlock className="w-4 h-4" />
                  I have an access code
                  {showAccessCode ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {showAccessCode && (
                  <form onSubmit={handleAccessCodeSubmit} className="mt-4 space-y-3">
                    <input
                      type="text"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                      placeholder="BLOSSOM-XXXXXXXX"
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400 font-mono text-center tracking-wider uppercase"
                      maxLength={32}
                      disabled={codeSubmitState === 'loading'}
                    />

                    {/* Error message for access code */}
                    {codeError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-red-600">{codeError}</p>
                      </div>
                    )}

                    {/* Success message */}
                    {codeSubmitState === 'success' && (
                      <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-green-600 font-medium">Access granted! Welcome to Blossom.</p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      variant="outline"
                      className="w-full"
                      disabled={codeSubmitState === 'loading' || !accessCode.trim()}
                    >
                      {codeSubmitState === 'loading' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4 mr-2" />
                          Unlock Access
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 bg-gray-50 text-center">
              <p className="text-xs text-gray-400">
                By joining, you agree to our terms of service
              </p>
            </div>
          </div>

          {/* Links below card */}
          <div className="mt-6 text-center">
            <div className="flex items-center justify-center gap-4 text-sm">
              <a
                href="https://stats.blossom.onl"
                target="_blank"
                rel="noopener"
                className="text-gray-400 hover:text-[#F25AA2] transition-colors"
              >
                Statistics
              </a>
              <span className="text-gray-300">•</span>
              <a
                href="https://whitepaper.blossom.onl"
                target="_blank"
                rel="noopener"
                className="text-gray-400 hover:text-[#F25AA2] transition-colors"
              >
                Whitepaper
              </a>
              <span className="text-gray-300">•</span>
              <a
                href="/"
                className="text-gray-400 hover:text-[#F25AA2] transition-colors"
              >
                Home
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
