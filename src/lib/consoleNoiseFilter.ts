/**
 * Console noise filter - suppresses known browser extension errors
 * Only filters extension-related connection errors, all other messages pass through
 */

let suppressedCount = 0;
let hasLoggedSummary = false;

/**
 * Check if a message should be suppressed (extension errors + WalletConnect noise)
 * Checks all args and stack traces safely
 */
function shouldSuppress(...args: any[]): boolean {
  // Stringify all args safely
  const allText = args
    .map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) {
        return `${arg.message} ${arg.stack || ''}`;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

  // Suppress WalletConnect/Reown API noise (400/403 when no project ID)
  const hasWalletConnectNoise =
    allText.includes('api.web3modal.org') ||
    allText.includes('api.web3modal.com') ||
    allText.includes('pulse.walletconnect') ||
    allText.includes('relay.walletconnect') ||
    allText.includes('verify.walletconnect') ||
    (allText.includes('walletconnect') && (allText.includes('400') || allText.includes('403'))) ||
    (allText.includes('reown') && (allText.includes('400') || allText.includes('403')));

  if (hasWalletConnectNoise) {
    return true;
  }

  // Must contain one of these extension error patterns
  const hasExtensionError =
    allText.includes('Could not establish connection. Receiving end does not exist.') ||
    allText.includes('Unchecked runtime.lastError') ||
    allText.includes('Receiving end does not exist');

  if (!hasExtensionError) {
    return false;
  }

  // AND must appear to come from an extension (check message and stack)
  const hasExtensionContext =
    allText.includes('contentScript') ||
    allText.includes('chrome-extension://') ||
    allText.includes('moz-extension://') ||
    allText.includes('extension://') ||
    allText.includes('Extension context invalidated');

  return hasExtensionContext;
}

/**
 * Install console noise filter (wraps console.error and console.warn)
 * Uses apply to preserve original stack traces for real errors
 */
export function installConsoleNoiseFilter(): void {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = function(...args: any[]) {
    if (shouldSuppress(...args)) {
      suppressedCount++;
      return; // Suppress this message
    }
    // Use originalError directly to preserve stack traces
    originalError(...args);
  };

  console.warn = function(...args: any[]) {
    if (shouldSuppress(...args)) {
      suppressedCount++;
      return; // Suppress this message
    }
    // Use originalWarn directly to preserve stack traces
    originalWarn(...args);
  };

  // Log summary once after a short delay (only if we suppressed anything)
  setTimeout(() => {
    if (suppressedCount > 0 && !hasLoggedSummary) {
      hasLoggedSummary = true;
      console.info(`[Demo] Suppressed ${suppressedCount} browser-extension console messages`);
    }
  }, 2000);
}

