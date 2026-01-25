/**
 * Polyfills for Solana wallet adapter compatibility with Vite
 *
 * Solana libs expect Node.js Buffer and process globals.
 * This minimal polyfill provides only what's needed.
 */

import { Buffer } from 'buffer';

// Polyfill Buffer global
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;

  // Minimal process polyfill
  if (!(window as any).process) {
    (window as any).process = {
      env: {},
      version: '',
      nextTick: (fn: () => void) => setTimeout(fn, 0),
    };
  }
}

export {};
