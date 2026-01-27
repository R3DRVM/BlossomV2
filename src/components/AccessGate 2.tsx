/**
 * Access Gate Component
 *
 * Production-ready access gate with:
 * - Access code validation
 * - Waitlist signup (email or wallet)
 * - Blurred app background
 */

import { useState, useEffect } from 'react';
import { BlossomLogo } from './BlossomLogo';
import { Button } from './ui/Button';
import { ChevronDown, ChevronUp, Mail, Wallet, Check, AlertCircle, Loader2 } from 'lucide-react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';

interface AccessGateProps {
  onAccessGranted: () => void;
}

type GateState = 'idle' | 'waitlist' | 'access_code' | 'success' | 'error';
type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export default function AccessGate({ onAccessGranted }: AccessGateProps) {
  const [gateState, setGateState] = useState<GateState>('idle');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [email, setEmail] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inputMode, setInputMode] = useState<'email' | 'wallet'>('email');

  // Check for existing access on mount
  useEffect(() => {
    const storedCode = localStorage.getItem('blossom_access_code');
    if (storedCode) {
      // Validate stored code
      validateAccessCode(storedCode, true);
    }

    // Auto-grant in development mode
    if (import.meta.env.DEV && import.meta.env.VITE_ACCESS_GATE_ENABLED !== 'true') {
      const timer = setTimeout(() => {
        onAccessGranted();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  async function validateAccessCode(code: string, silent = false) {
    if (!silent) {
      setSubmitState('loading');
    }
    setErrorMessage('');

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/access/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (data.ok && data.valid) {
        localStorage.setItem('blossom_access_code', code);
        setSubmitState('success');
        setGateState('success');
        setTimeout(() => {
          onAccessGranted();
        }, 500);
      } else {
        if (!silent) {
          setSubmitState('error');
          setErrorMessage(data.error || 'Invalid access code');
        }
        localStorage.removeItem('blossom_access_code');
      }
    } catch (error) {
      if (!silent) {
        setSubmitState('error');
        setErrorMessage('Failed to validate code. Please try again.');
      }
      localStorage.removeItem('blossom_access_code');
    }
  }

  async function submitWaitlist() {
    if (!email && !walletAddress) {
      setErrorMessage('Please enter an email or wallet address');
      return;
    }

    setSubmitState('loading');
    setErrorMessage('');

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email || undefined,
          walletAddress: walletAddress || undefined,
          source: 'app_gate',
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setSubmitState('success');
        setGateState('success');
      } else {
        setSubmitState('error');
        setErrorMessage(data.error || 'Failed to join waitlist');
      }
    } catch (error) {
      setSubmitState('error');
      setErrorMessage('Failed to join waitlist. Please try again.');
    }
  }

  function handleAccessCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (accessCode.trim()) {
      validateAccessCode(accessCode.trim());
    }
  }

  function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitWaitlist();
  }

  // Success state
  if (gateState === 'success' && submitState === 'success' && !showAccessCode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {showAccessCode ? 'Access Granted!' : 'You\'re on the list!'}
          </h2>
          <p className="text-gray-600">
            {showAccessCode ? 'Welcome to Blossom.' : 'We\'ll notify you when your access is ready.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Blurred background */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-pink-50/90 via-white/95 to-purple-50/90 backdrop-blur-sm"
        style={{
          backgroundImage: `
            radial-gradient(circle at 20% 50%, rgba(242, 90, 162, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(147, 51, 234, 0.06) 0%, transparent 50%),
            radial-gradient(circle at 40% 80%, rgba(236, 72, 153, 0.05) 0%, transparent 50%)
          `,
        }}
      />

      {/* Gate card */}
      <div className="relative w-full max-w-md mx-4">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center border-b border-gray-50">
            <div className="flex justify-center mb-4">
              <BlossomLogo size={48} className="drop-shadow-sm" />
            </div>
            <h1
              className="text-2xl font-bold text-gray-900 mb-2"
              style={{ fontFamily: '"Playfair Display", serif' }}
            >
              Blossom
            </h1>
            <p className="text-gray-500 text-sm">
              AI-powered trading copilot for DeFi
            </p>
          </div>

          {/* Content */}
          <div className="px-8 py-6">
            {/* Waitlist form */}
            <form onSubmit={handleWaitlistSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Join the waitlist
                </label>

                {/* Input mode toggle */}
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setInputMode('email')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      inputMode === 'email'
                        ? 'bg-pink-50 text-pink-600 border border-pink-200'
                        : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('wallet')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      inputMode === 'wallet'
                        ? 'bg-pink-50 text-pink-600 border border-pink-200'
                        : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <Wallet className="w-4 h-4" />
                    Wallet
                  </button>
                </div>

                {/* Input field */}
                {inputMode === 'email' ? (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                  />
                ) : (
                  <input
                    type="text"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="0x... or wallet.sol"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400 font-mono text-sm"
                  />
                )}
              </div>

              {/* Error message */}
              {errorMessage && !showAccessCode && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-600">{errorMessage}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={submitState === 'loading' || (!email && !walletAddress)}
              >
                {submitState === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Joining...
                  </>
                ) : (
                  'Join Waitlist'
                )}
              </Button>
            </form>

            {/* Access code section */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <button
                onClick={() => setShowAccessCode(!showAccessCode)}
                className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Have an access code?
                {showAccessCode ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showAccessCode && (
                <form onSubmit={handleAccessCodeSubmit} className="mt-4">
                  <input
                    type="text"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                    placeholder="Enter access code"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-pink-300 focus:ring-2 focus:ring-pink-100 outline-none transition-colors text-gray-900 placeholder:text-gray-400 font-mono text-center tracking-widest uppercase"
                    maxLength={20}
                  />

                  {/* Error message for access code */}
                  {errorMessage && showAccessCode && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-red-600">{errorMessage}</p>
                    </div>
                  )}

                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full mt-3"
                    disabled={submitState === 'loading' || !accessCode.trim()}
                  >
                    {submitState === 'loading' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Validating...
                      </>
                    ) : (
                      'Unlock Access'
                    )}
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 text-center">
            <p className="text-xs text-gray-400">
              By joining, you agree to our terms of service.
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
              className="text-gray-500 hover:text-pink-500 transition-colors"
            >
              Statistics
            </a>
            <span className="text-gray-300">•</span>
            <a
              href="https://whitepaper.blossom.onl"
              target="_blank"
              rel="noopener"
              className="text-gray-500 hover:text-pink-500 transition-colors"
            >
              Whitepaper
            </a>
            <span className="text-gray-300">•</span>
            <a
              href="/"
              className="text-gray-500 hover:text-pink-500 transition-colors"
            >
              Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
