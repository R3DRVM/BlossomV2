/**
 * Global Error Handlers
 *
 * Catches unhandled errors and promise rejections to prevent
 * white-screen crashes and provide better debugging info.
 */

export function initGlobalErrorHandlers(): void {
  // Handle uncaught errors
  window.addEventListener('error', (event: ErrorEvent) => {
    // Suppress noisy errors that don't affect functionality
    const ignoredPatterns = [
      'ResizeObserver loop',
      'Script error',
      'Non-Error exception captured',
    ];

    const message = event.message || '';
    if (ignoredPatterns.some(pattern => message.includes(pattern))) {
      event.preventDefault();
      return;
    }

    console.error('[GlobalError]', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    // Suppress common non-critical rejections
    const reason = event.reason;
    const message = reason?.message || String(reason) || '';

    const ignoredPatterns = [
      'AbortError',
      'The operation was aborted',
      'Load failed',
      'cancelled',
    ];

    if (ignoredPatterns.some(pattern => message.includes(pattern))) {
      event.preventDefault();
      return;
    }

    console.error('[UnhandledRejection]', reason);
  });
}
