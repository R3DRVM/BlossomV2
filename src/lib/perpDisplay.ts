/**
 * Canonical perp display utilities - single source of truth for Entry/TP/SL
 * Ensures consistent display across MessageBubble, ExecutionDetailsDisclosure, and PerpPositionEditor
 */

import { Strategy } from '../context/BlossomContext';
import { getLiveSpotForMarket, computeIndicativeTpSl, marketToSpotSymbol } from './liveSpot';
import { getCachedLiveTicker } from './liveSpot';

export interface PerpDisplayData {
  entryUsd: number;
  tpUsd: number | null;
  slUsd: number | null;
  source: 'coingecko' | 'agent' | 'static';
  lastUpdatedMs: number;
  hasLiveData: boolean;
}

/**
 * Get canonical perp display data (entry + TP/SL) for a strategy
 * Uses live price when available, falls back to strategy values
 * Never throws - always returns valid data
 */
export async function getCanonicalPerpDisplay(strategy: Strategy): Promise<PerpDisplayData> {
  // Only compute for perp instruments
  if (strategy.instrumentType !== 'perp' || !strategy.market || !strategy.side) {
    return {
      entryUsd: strategy.entry || 0,
      tpUsd: strategy.takeProfit || null,
      slUsd: strategy.stopLoss || null,
      source: 'static',
      lastUpdatedMs: Date.now(),
      hasLiveData: false,
    };
  }

  try {
    // Try direct market lookup first (most accurate)
    const liveEntrySnapshot = await getLiveSpotForMarket(strategy.market);
    
    if (liveEntrySnapshot && liveEntrySnapshot.entryUsd > 0) {
      // Use live entry and compute indicative TP/SL
      const indicativeTpSl = computeIndicativeTpSl({
        side: strategy.side,
        entry: liveEntrySnapshot.entryUsd,
      });
      
      return {
        entryUsd: liveEntrySnapshot.entryUsd,
        tpUsd: indicativeTpSl.tp,
        slUsd: indicativeTpSl.sl,
        source: liveEntrySnapshot.source,
        lastUpdatedMs: Date.now(),
        hasLiveData: true,
      };
    }

    // Fallback: try cached ticker
    const spotSymbol = marketToSpotSymbol(strategy.market);
    if (spotSymbol) {
      const cachedPrices = await getCachedLiveTicker();
      const liveEntry = cachedPrices[spotSymbol];
      
      if (liveEntry && liveEntry > 0) {
        const indicativeTpSl = computeIndicativeTpSl({
          side: strategy.side,
          entry: liveEntry,
        });
        
        return {
          entryUsd: liveEntry,
          tpUsd: indicativeTpSl.tp,
          slUsd: indicativeTpSl.sl,
          source: 'agent', // Cached ticker comes from agent or demo feed
          lastUpdatedMs: Date.now(),
          hasLiveData: true,
        };
      }
    }
  } catch (error) {
    // Fail silently, fall back to strategy values
  }

  // Final fallback: use strategy values
  return {
    entryUsd: strategy.entry || 0,
    tpUsd: strategy.takeProfit || null,
    slUsd: strategy.stopLoss || null,
    source: 'static',
    lastUpdatedMs: Date.now(),
    hasLiveData: false,
  };
}


