/**
 * Step 1: Strict market extraction - no fallbacks, no defaults
 * Returns canonical market symbol or null/ambiguous
 */

export type MarketExtractionResult = 
  | { type: 'single'; market: string }  // e.g., 'BTC-PERP'
  | { type: 'ambiguous'; markets: string[] }  // e.g., ['BTC-PERP', 'ETH-PERP']
  | { type: 'none' };  // No market found

const MARKET_ALIASES: Record<string, string> = {
  'BITCOIN': 'BTC',
  'BITCOIN-PERP': 'BTC',
  'BTC': 'BTC',
  'ETH': 'ETH',
  'ETHEREUM': 'ETH',
  'ETHEREUM-PERP': 'ETH',
  'SOL': 'SOL',
  'SOLANA': 'SOL',
  'SOLANA-PERP': 'SOL',
  'BNB': 'BNB',
  'BINANCE': 'BNB',
  'AVAX': 'AVAX',
  'AVALANCHE': 'AVAX',
};

const SUPPORTED_MARKETS = ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX'];

/**
 * Extract market from text with strict rules:
 * - Returns canonical market (e.g., 'BTC-PERP')
 * - Returns ambiguous if multiple markets found
 * - Returns none if no market found
 * - NEVER defaults to a fallback market
 * 
 * Enhanced detection for:
 * - "open long on eth" -> ETH-PERP
 * - "short btc" -> BTC-PERP
 * - "long btc and eth" -> ambiguous
 */
export function extractMarketStrict(text: string): MarketExtractionResult {
  const foundMarkets = new Set<string>();
  
  // Step A: Pattern 1 - "open a short for ETH", "open long for eth"
  const forMarketPattern = /\bfor\s+(ETH|ETHEREUM|BTC|BITCOIN|SOL|SOLANA|BNB|BINANCE|AVAX|AVALANCHE)\b/i;
  const forMatch = text.match(forMarketPattern);
  if (forMatch) {
    const marketToken = forMatch[1].toUpperCase();
    const mappedMarket = MARKET_ALIASES[marketToken] || marketToken;
    if (SUPPORTED_MARKETS.includes(mappedMarket)) {
      foundMarkets.add(mappedMarket);
    }
  }
  
  // Step A: Pattern 2 - "short ETH", "long ETH" (even with punctuation)
  const sideMarketPattern = /\b(long|short)\s+(ETH|ETHEREUM|BTC|BITCOIN|SOL|SOLANA|BNB|BINANCE|AVAX|AVALANCHE)(?:\s+perp|\s+perpetual|\s+perps)?\b/i;
  const sideMatch = text.match(sideMarketPattern);
  if (sideMatch) {
    const marketToken = sideMatch[2].toUpperCase();
    const mappedMarket = MARKET_ALIASES[marketToken] || marketToken;
    if (SUPPORTED_MARKETS.includes(mappedMarket)) {
      foundMarkets.add(mappedMarket);
    }
  }
  
  // Step A: Pattern 3 - "on ETH", "in ETH"
  const onInMarketPattern = /\b(on|in)\s+(ETH|ETHEREUM|BTC|BITCOIN|SOL|SOLANA|BNB|BINANCE|AVAX|AVALANCHE)\b/i;
  const onInMatch = text.match(onInMarketPattern);
  if (onInMatch) {
    const marketToken = onInMatch[2].toUpperCase();
    const mappedMarket = MARKET_ALIASES[marketToken] || marketToken;
    if (SUPPORTED_MARKETS.includes(mappedMarket)) {
      foundMarkets.add(mappedMarket);
    }
  }
  
  // Step A: Pattern 4 - "ETH with 5x leverage", "ETH using 1k" (bare ticker near trade verbs)
  // Only accept if message contains trade intent (open/long/short/buy/sell)
  const hasTradeIntent = /\b(open|long|short|buy|sell|enter|start|new)\b/i.test(text);
  if (hasTradeIntent) {
    // Look for bare ticker within ~6 tokens of trade verbs
    const tradeVerbPositions: number[] = [];
    const tradeVerbPattern = /\b(open|long|short|buy|sell|enter|start|new)\b/gi;
    let match;
    while ((match = tradeVerbPattern.exec(text)) !== null) {
      tradeVerbPositions.push(match.index);
    }
    
    // Check each supported market as bare ticker
    for (const market of SUPPORTED_MARKETS) {
      const marketPattern = new RegExp(`\\b${market}\\b`, 'i');
      const marketMatch = text.match(marketPattern);
      if (marketMatch && marketMatch.index !== undefined) {
        // Check if market is within ~6 tokens (roughly 30 chars) of any trade verb
        const marketPos = marketMatch.index;
        const isNearTradeVerb = tradeVerbPositions.some(verbPos => {
          const distance = Math.abs(marketPos - verbPos);
          return distance < 30; // ~6 tokens
        });
        
        if (isNearTradeVerb && !foundMarkets.has(market)) {
          foundMarkets.add(market);
        }
      }
    }
  }
  
  // Legacy: "eth perp", "eth-perp", "ethereum perp"
  const perpPattern = /\b(ETH|ETHEREUM|BTC|BITCOIN|SOL|SOLANA|BNB|BINANCE|AVAX|AVALANCHE)(?:\s+perp|\s+perpetual|\s+perps|[-_]perp)\b/i;
  const perpMatch = text.match(perpPattern);
  if (perpMatch) {
    const marketToken = perpMatch[1].toUpperCase();
    const mappedMarket = MARKET_ALIASES[marketToken] || marketToken;
    if (SUPPORTED_MARKETS.includes(mappedMarket)) {
      foundMarkets.add(mappedMarket);
    }
  }
  
  // Fallback: Check for explicit market mentions (aliases + direct) - but only if no patterns matched yet
  // This is a fallback, but we still use word boundaries
  if (foundMarkets.size === 0) {
    for (const [alias, mappedMarket] of Object.entries(MARKET_ALIASES)) {
      const aliasPattern = new RegExp(`\\b${alias}\\b`, 'i');
      if (aliasPattern.test(text)) {
        foundMarkets.add(mappedMarket);
      }
    }
    
    // Also check SUPPORTED_MARKETS for direct matches with word boundaries
    for (const market of SUPPORTED_MARKETS) {
      const marketPattern = new RegExp(`\\b${market}\\b`, 'i');
      if (marketPattern.test(text) && !foundMarkets.has(market)) {
        foundMarkets.add(market);
      }
    }
  }
  
  // Convert to canonical format (add -PERP suffix)
  const canonicalMarkets = Array.from(foundMarkets).map(m => `${m}-PERP`);
  
  if (canonicalMarkets.length === 0) {
    return { type: 'none' };
  }
  
  if (canonicalMarkets.length === 1) {
    return { type: 'single', market: canonicalMarkets[0] };
  }
  
  return { type: 'ambiguous', markets: canonicalMarkets };
}

/**
 * Generate clarification message for missing/ambiguous markets
 */
export function generateMarketClarification(result: MarketExtractionResult): string {
  if (result.type === 'none') {
    return 'Which market do you want: BTC-PERP, ETH-PERP, SOL-PERP, AVAX-PERP, or BNB-PERP?';
  }
  
  if (result.type === 'ambiguous') {
    return `Which market do you want: ${result.markets.join(' or ')}?`;
  }
  
  return ''; // Should not happen
}

