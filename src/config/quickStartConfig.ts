export type QuickStartCategoryId =
  | 'perps'
  | 'defi'
  | 'events'
  | 'risk'
  | 'portfolio'
  | 'explore';

export interface QuickStartSubPrompt {
  id: string;
  label: string;       // text shown in the UI
  prompt: string;      // text inserted into the chat input
}

export interface QuickStartCategory {
  id: QuickStartCategoryId;
  label: string;
  description: string;
  subPrompts: QuickStartSubPrompt[];
}

export const QUICK_START_CATEGORIES: QuickStartCategory[] = [
  {
    id: 'perps',
    label: 'Perp strategies',
    description: 'Plan and manage perp trades',
    subPrompts: [
      {
        id: 'long-eth-3pct',
        label: 'Long ETH with 3% risk',
        prompt: 'Long ETH with 3% risk and manage liquidation for me.'
      },
      {
        id: 'hedge-sol-spot',
        label: 'Hedge my SOL spot',
        prompt: 'Hedge my SOL spot with perps at 2% risk.'
      },
      {
        id: 'market-neutral-btc',
        label: 'Market-neutral BTC funding',
        prompt: 'Build a market-neutral funding strategy on BTC.'
      },
      {
        id: 'optimize-existing-perps',
        label: 'Optimize my open perp positions',
        prompt: 'Review my open perp trades and optimize TP/SL and position sizing based on current risk.'
      }
    ]
  },
  {
    id: 'defi',
    label: 'DeFi yield',
    description: 'Park idle capital into yield',
    subPrompts: [
      {
        id: 'safest-usdc-kamino',
        label: 'Safest REDACTED yield (Kamino)',
        prompt: 'Park half my idle REDACTED into the safest yield on Kamino.'
      },
      {
        id: 'ladder-yield',
        label: 'Ladder my DeFi yields',
        prompt: 'Build a ladder of DeFi positions from safest to higher yield within my risk limits.'
      },
      {
        id: 'reallocate-defi',
        label: 'Reallocate existing DeFi plan',
        prompt: 'Review my current DeFi yield plan and reallocate toward higher APY while keeping my risk preference the same.'
      }
    ]
  },
  {
    id: 'events',
    label: 'Event markets',
    description: 'Kalshi & prediction markets',
    subPrompts: [
      {
        id: 'top-kalshi',
        label: 'Top 5 Kalshi markets',
        prompt: 'What are the top 5 prediction markets on Kalshi right now?'
      },
      {
        id: 'top-polymarket',
        label: 'Top 5 Polymarket markets',
        prompt: 'What are the top 5 trending prediction markets on Polymarket?'
      },
      {
        id: 'risk-2pct-highest-volume',
        label: 'Risk 2% on highest volume',
        prompt: 'Risk 2% of my account on the highest-volume prediction market.'
      }
    ]
  },
  {
    id: 'risk',
    label: 'Risk & hedging',
    description: 'See and adjust portfolio risk',
    subPrompts: [
      {
        id: 'show-riskiest-positions',
        label: 'Show my riskiest positions',
        prompt: 'Show my riskiest positions and how to reduce risk.'
      },
      {
        id: 'optimize-risk',
        label: 'Optimize risk settings',
        prompt: 'Review my open strategies and propose safer TP/SL and leverage settings within my risk preferences.'
      },
      {
        id: 'stress-test',
        label: 'Stress-test my portfolio',
        prompt: 'Run a simple stress test: what happens to my PnL if ETH drops 15% and BTC drops 10%?'
      }
    ]
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'Summaries & insights',
    subPrompts: [
      {
        id: 'portfolio-summary',
        label: 'Summarize my portfolio',
        prompt: 'Give me a summary of my portfolio: spot, perps, DeFi, and event markets with risk highlights.'
      },
      {
        id: 'performance-last-7d',
        label: 'Performance (last 7 days)',
        prompt: 'Summarize my performance over the last 7 days and highlight the top contributors to PnL.'
      }
    ]
  },
  {
    id: 'explore',
    label: 'Explore ideas',
    description: 'New strategies & what-if scenarios',
    subPrompts: [
      {
        id: 'suggest-strategies',
        label: 'Suggest 3 strategies',
        prompt: 'Suggest three different strategies I can try today across perps, DeFi, and event markets, within 3% max risk per strategy.'
      },
      {
        id: 'what-if-scenario',
        label: 'What if ETH runs to $5k?',
        prompt: 'If ETH rallied to $5,000 in the next 6 months, how should I position my account now?'
      }
    ]
  }
];

