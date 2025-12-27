/**
 * Risk Intent Detection
 * Detects high-risk trading requests that should trigger a confirmation flow
 */

export interface HighRiskDetection {
  isHighRisk: boolean;
  reasons: string[];
  extracted?: {
    leverage?: number;
    wantsNoStopLoss?: boolean;
    wantsFullPort?: boolean;
    wantsRestOfPortfolio?: boolean; // Step 4: "rest of portfolio" = remaining USDC collateral
  };
}

export function detectHighRiskIntent(userText: string): HighRiskDetection {
  const reasons: string[] = [];
  const extracted: HighRiskDetection['extracted'] = {};

  // Detect high leverage (>= 10x)
  const leveragePatterns = [
    /(\d+(?:\.\d+)?)\s*x/i, // "20x", "50x", "20 x"
    /(?:leverage|lev)\s*(?:of|at|to)?\s*(\d+(?:\.\d+)?)/i, // "leverage 20", "lev 50"
  ];

  for (const pattern of leveragePatterns) {
    const match = userText.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (value >= 10) {
        extracted.leverage = value;
        reasons.push(`Requested high leverage (${value}x)`);
        break;
      }
    }
  }

  // Step 4: Detect "rest of portfolio" / "remaining portfolio" (different from "entire portfolio")
  const restOfPortPatterns = [
    /\b(?:rest|remaining|leftover|whatever is left|what's left)\s+(?:of\s+)?(?:my\s+)?(?:portfolio|balance|account|capital|funds|money|collateral)\b/i,
    /\b(?:portfolio|balance|account|capital|funds|money|collateral)\s+(?:rest|remaining|leftover|left)\b/i,
  ];

  let hasRestOfPortfolio = false;
  for (const pattern of restOfPortPatterns) {
    if (pattern.test(userText)) {
      extracted.wantsRestOfPortfolio = true;
      hasRestOfPortfolio = true;
      reasons.push('Requested remaining portfolio allocation');
      break;
    }
  }

  // Detect full portfolio / all-in requests (distinct from "rest of")
  // Feature 7: Make them mutually exclusive - if "rest/remaining" appears, prefer that over "entire"
  if (!hasRestOfPortfolio) {
    const fullPortPatterns = [
      /\b(?:entire|full|all|100%|all in)\s+(?:portfolio|balance|account|capital|funds|money)\b/i,
      /\b(?:portfolio|balance|account|capital|funds|money)\s+(?:entire|full|all|100%)\b/i,
      /\b(?:use|risk|put|deploy)\s+(?:entire|full|all|100%|everything)\b/i,
      /\b(?:entire|full|all|100%)\s+(?:portfolio|balance|account|capital|funds|money)\b/i,
    ];

    for (const pattern of fullPortPatterns) {
      if (pattern.test(userText)) {
        extracted.wantsFullPort = true;
        reasons.push('Requested full-portfolio allocation');
        break;
      }
    }
  }

  // Detect no stop loss requests
  const noSlPatterns = [
    /\b(?:no|without|omit|skip)\s+(?:stop\s*loss|sl|stop\s*loss\s*order)\b/i,
    /\b(?:stop\s*loss|sl)\s+(?:no|none|off|disabled)\b/i,
    /\b(?:don'?t|do\s+not)\s+(?:set|add|include|use)\s+(?:a\s+)?(?:stop\s*loss|sl)\b/i,
  ];

  for (const pattern of noSlPatterns) {
    if (pattern.test(userText)) {
      extracted.wantsNoStopLoss = true;
      reasons.push('Requested no stop-loss');
      break;
    }
  }

  return {
    isHighRisk: reasons.length > 0,
    reasons: reasons.slice(0, 3), // Max 3 reasons
    extracted: reasons.length > 0 ? extracted : undefined,
  };
}

