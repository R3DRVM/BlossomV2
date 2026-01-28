/**
 * Access Gate Hook
 * Manages beta access gate state and authorization
 */

import { useState, useEffect } from 'react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';

export function useAccessGate() {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null); // null = checking
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthorization();

    // Listen for access expired event (e.g., from 401/403 API errors)
    const handleAccessExpired = () => {
      console.log('[useAccessGate] Access expired, reopening gate');
      setIsAuthorized(false);
      setIsLoading(false);
    };

    window.addEventListener('blossom-access-expired', handleAccessExpired);
    return () => window.removeEventListener('blossom-access-expired', handleAccessExpired);
  }, []);

  async function checkAuthorization() {
    // If gate is disabled in dev, auto-authorize
    if (import.meta.env.DEV && import.meta.env.VITE_ACCESS_GATE_ENABLED !== 'true') {
      setIsAuthorized(true);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/access/status`, {
        credentials: 'include', // Include cookies
      });

      const data = await response.json();

      if (data.ok && data.authorized) {
        setIsAuthorized(true);
      } else {
        setIsAuthorized(false);
      }
    } catch (error) {
      console.error('[useAccessGate] Authorization check failed:', error);
      // Fail-closed: show gate if check fails
      setIsAuthorized(false);
    } finally {
      setIsLoading(false);
    }
  }

  function grantAccess() {
    setIsAuthorized(true);
  }

  return {
    isAuthorized,
    isLoading,
    grantAccess,
    recheckAuthorization: checkAuthorization,
  };
}
