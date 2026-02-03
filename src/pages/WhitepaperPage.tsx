/**
 * Whitepaper Page
 * Renders the Blossom whitepaper/overview document
 * Accessible at whitepaper.blossom.onl or /whitepaper
 */

import { useEffect, useState } from 'react';
import { BlossomLogo } from '../components/BlossomLogo';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Import the whitepaper content
// In production, this would be fetched or bundled
const WHITEPAPER_CONTENT = `
# Blossom Execution Layer

**Version 1.0 | January 2025**

---

## Executive Summary

Blossom is an **intelligent execution layer** that allows users to deploy, hedge, and manage capital across markets through a unified, non-custodial interface. Blossom sits above execution venues, translating user intent into deterministic, auditable execution plans across chains, protocols, and asset classes.
Beyond serving end users directly, Blossom provides its execution intelligence as infrastructure. Any wallet, dApp, trading terminal, or DeFi protocol can integrate Blossom through an API key—instantly gaining access to smart routing, intent processing, and cross-chain coordination without building complex trading infrastructure from scratch.

### The Execution Gap

On-chain markets have reached infrastructure maturity. Block times measured in milliseconds, liquidity pools rivaling centralized exchanges, and sophisticated financial primitives spanning perpetuals, options, and prediction markets now exist across dozens of chains. Yet the tools for deploying capital across this infrastructure remain primitive.
Today’s on-chain trader faces a fragmented landscape: perpetual DEXs on Hyperliquid, spot liquidity on Uniswap, prediction markets on Polymarket and Kalshi, yield opportunities across DeFi protocols—each requiring separate interfaces, wallets, and mental models. Executing a hedged position across these venues requires manual coordination, introduces operational risk, and provides no unified view of portfolio exposure.
This gap between infrastructure capability and execution tooling represents the core opportunity Blossom addresses.

### The Blossom Thesis

**Execution intelligence** is the missing layer in on-chain finance.
Protocols solve for liquidity and settlement. Chains solve for throughput and finality. No layer exists to solve for user intent, translating what a trader wants to achieve into optimal execution across the available infrastructure.
Blossom fills this gap by functioning as:

- **Intent-to-Execution Translation Engine**: Converting natural language and structured inputs into deterministic, auditable execution plans
- **Cross-Protocol Coordinator**: Orchestrating trades across chains, venues, and asset classes without custody
- **Unified Risk Interface**: Aggregating exposure across fragmented positions into coherent portfolio analytics
- **API Infrastructure Layer**: Providing programmatic access so any protocol can build on Blossom’s execution intelligence
Blossom is both a product and a platform. Users can interact with Blossom directly for intelligent execution. Developers integrate Blossom’s API to bring that same execution intelligence to their own applications.
---


### Core Value Proposition

- **Natural Language Trading**: Execute complex strategies by simply describing your intent
- **Multi-Chain Execution**: Trade across Ethereum, Solana, and L2s from a single interface
- **AI-Powered Risk Management**: Automated position monitoring and protection
- **Non-Custodial Architecture**: Your keys, your crypto—always

---

## The Problem

DeFi trading today requires users to:
1. Navigate multiple interfaces across different protocols
2. Manually monitor positions across chains
3. Execute complex multi-step transactions
4. Manage risk parameters manually
5. Stay awake for 24/7 markets

This creates significant friction and risk, especially for users who want exposure to DeFi opportunities but lack the technical expertise or time to manage positions actively.

---

## The Blossom Solution

### 1. Intent-Based Execution

Users express their trading intent in natural language:

\`\`\`
"Long BTC 10x with 5% of my portfolio, set stop loss at -3%"
\`\`\`

Blossom's AI planner:
- Parses the intent into structured parameters
- Validates against current market conditions
- Generates an optimal execution plan
- Routes to the best available venue

### 2. Confirm Mode Execution

Every execution follows a safe, auditable flow:

\`\`\`
User Intent → AI Planning → User Confirmation → Execution → Verification
\`\`\`

Users always see exactly what will happen before any transaction is signed.

### 3. Multi-Venue Routing

Blossom aggregates liquidity across:
- **Perps**: Hyperliquid, dYdX, Drift
- **Spot DEXs**: Uniswap, Jupiter, Raydium
- **Lending**: Aave, Kamino, Compound
- **Prediction Markets**: Polymarket, Kalshi

### 4. Cross-Chain Execution

Execute strategies that span multiple chains:
- Bridge assets automatically via Wormhole, LiFi
- Atomic cross-chain swaps
- Unified portfolio view across all chains

---

## Architecture

### System Overview

\`\`\`
┌─────────────────────────────────────┐
│        User Interface               │
│  (Chat + Portfolio Dashboard)       │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│        AI Planner Layer             │
│  (Intent Parsing + Strategy Gen)    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│       Execution Router              │
│  (Venue Selection + Tx Building)    │
└─────────────────┬───────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Ethereum │ │  Solana  │ │   L2s    │
└──────────┘ └──────────┘ └──────────┘
\`\`\`

### Security Model

1. **Non-Custodial**: All transactions require user signature
2. **Session Mode**: Optional delegated execution with spending limits
3. **Adapter Allowlist**: Only whitelisted contracts can be called
4. **Atomic Execution**: All-or-nothing transaction execution

---

## Execution Modes

### Mode A: Direct Execution
- User signs each transaction directly
- Maximum security, full control
- Best for high-value trades

### Mode B: Session Mode
- One-time session creation with spending limits
- Enables one-click execution
- Automatic expiration after 7 days

### Mode C: Confirm Mode (Default)
- AI generates execution plan
- User reviews and confirms
- Execution proceeds after confirmation

---

## Supported Operations

### Perpetual Futures
- Long/Short positions
- Leverage up to 50x
- Automated stop-loss/take-profit
- Cross-margin support

### Spot Trading
- Token swaps
- Limit orders
- DCA strategies
- Portfolio rebalancing

### Lending & Yield
- Supply to lending protocols
- Borrow against collateral
- Yield optimization
- Auto-compound

### Prediction Markets
- Event contracts
- Political markets
- Sports betting
- Binary outcomes

---

## Risk Management

### Position Monitoring
- Real-time PnL tracking
- Liquidation distance alerts
- Volatility-adjusted sizing

### Automated Protection
- Stop-loss execution
- Take-profit triggers
- Trailing stops
- Emergency liquidation

### Portfolio Limits
- Maximum position size
- Leverage caps
- Correlation limits
- Drawdown protection

---

## Roadmap

### Phase 1: Foundation (Q1 2026) 
- Core chat interface
- Beta execution engine
- Complete AI execution logic and testing
- Private beta deployment

### Phase 2: Testnet MVP (Q1 2026) 
- Public beta deployment
- Developer API testing
- Hybrid routing

### Phase 3: Production (Q2 2026)
- Mainnet deployment
- Additional venues
- Advanced strategies
- API & SDK private beta

### Phase 4: Scale (Q3 2026)
- Multi-chain expansion
- Institutional features
- API access
- SDK release

---

## Team

Blossom is built by a team of experienced DeFi developers and AI researchers with backgrounds from leading crypto projects and AI labs.

---

## Conclusion

On-chain finance has matured technically but remains primitive in execution. Users interact with protocols individually, manage risk manually, and piece together fragmented interfaces to execute coherent strategies.

Blossom introduces execution intelligence as a new primitive, translating what users want to achieve into how to achieve it optimally. By sitting above protocols and coordinating across them, Blossom can deliver institutional-grade execution to any participant while remaining fully on-chain and non-custodial.

**Join the waitlist at [blossom.onl](https://app.blossom.onl)**

---

*This document is for informational purposes only and does not constitute financial advice. Trading cryptocurrencies and derivatives involves substantial risk of loss.*
`;

export default function WhitepaperPage() {
  const navigate = useNavigate();
  const [content, setContent] = useState<string>(WHITEPAPER_CONTENT);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <BlossomLogo size={24} />
              <span className="font-semibold text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
                Blossom
              </span>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Whitepaper v1.0
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <article className="prose prose-lg prose-gray max-w-none">
          {/* Render markdown content */}
          <div
            className="whitepaper-content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(content)
            }}
          />
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="container mx-auto px-6 text-center text-sm text-gray-500">
          <p>© 2025 Blossom Protocol. All rights reserved.</p>
          <p className="mt-2">
            <a href="/" className="text-pink-500 hover:underline">blossom.onl</a>
          </p>
        </div>
      </footer>

      <style>{`
        .whitepaper-content h1 {
          font-family: 'Playfair Display', serif;
          font-size: 2.5rem;
          font-weight: 700;
          color: #111;
          margin-bottom: 0.5rem;
          border-bottom: 2px solid #F25AA2;
          padding-bottom: 1rem;
        }

        .whitepaper-content h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.75rem;
          font-weight: 600;
          color: #111;
          margin-top: 3rem;
          margin-bottom: 1rem;
        }

        .whitepaper-content h3 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #333;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
        }

        .whitepaper-content p {
          color: #444;
          line-height: 1.8;
          margin-bottom: 1rem;
        }

        .whitepaper-content ul, .whitepaper-content ol {
          margin-left: 1.5rem;
          margin-bottom: 1rem;
        }

        .whitepaper-content li {
          color: #444;
          line-height: 1.7;
          margin-bottom: 0.5rem;
        }

        .whitepaper-content code {
          background: #f5f5f5;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          color: #E11D48;
        }

        .whitepaper-content pre {
          background: #1a1a2e;
          color: #e0e0e0;
          padding: 1.5rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 1.5rem 0;
          max-width: 100%;
        }

        .whitepaper-content pre code {
          background: transparent;
          padding: 0;
          color: inherit;
          font-size: 0.75rem;
          line-height: 1.4;
        }

        /* Make ASCII diagrams responsive on smaller screens */
        @media (max-width: 768px) {
          .whitepaper-content pre code {
            font-size: 0.55rem;
          }
        }

        .whitepaper-content blockquote {
          border-left: 3px solid #F25AA2;
          padding-left: 1rem;
          margin-left: 0;
          color: #666;
          font-style: italic;
        }

        .whitepaper-content hr {
          border: none;
          border-top: 1px solid #e5e5e5;
          margin: 2rem 0;
        }

        .whitepaper-content strong {
          color: #111;
          font-weight: 600;
        }

        .whitepaper-content a {
          color: #F25AA2;
          text-decoration: none;
        }

        .whitepaper-content a:hover {
          text-decoration: underline;
        }

        .whitepaper-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5rem 0;
        }

        .whitepaper-content th, .whitepaper-content td {
          border: 1px solid #e5e5e5;
          padding: 0.75rem;
          text-align: left;
        }

        .whitepaper-content th {
          background: #f9f9f9;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

/**
 * Simple markdown to HTML renderer
 * For production, use a proper markdown library
 */
function renderMarkdown(md: string): string {
  let html = md;

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr />');

  // Lists (simple version)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Paragraphs (wrap text blocks not already in tags)
  const lines = html.split('\n');
  const processed: string[] = [];
  let inParagraph = false;
  let paragraphContent = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlock = /^<(h[1-6]|ul|ol|li|pre|code|hr|blockquote)/.test(trimmed) ||
                    /<\/(h[1-6]|ul|ol|li|pre|code|blockquote)>$/.test(trimmed) ||
                    trimmed === '';

    if (isBlock) {
      if (inParagraph && paragraphContent) {
        processed.push(`<p>${paragraphContent.trim()}</p>`);
        paragraphContent = '';
        inParagraph = false;
      }
      processed.push(line);
    } else {
      inParagraph = true;
      paragraphContent += (paragraphContent ? ' ' : '') + trimmed;
    }
  }

  if (inParagraph && paragraphContent) {
    processed.push(`<p>${paragraphContent.trim()}</p>`);
  }

  return processed.join('\n');
}
