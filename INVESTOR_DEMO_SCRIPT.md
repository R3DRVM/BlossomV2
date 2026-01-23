# Blossom MVP - Investor Demo Script

**Duration:** 5-7 minutes
**Goal:** Showcase AI-powered execution across DeFi, Perps, and Event Markets

---

## Setup (Before Demo - 2 minutes)

### Pre-Demo Checklist:
1. Backend running: `cd agent && npm run dev`
2. Frontend running: `npm run dev` (http://localhost:5173)
3. Wallet connected to Sepolia
4. One-click execution enabled
5. Demo tokens minted (10k USDC, 5 WETH)
6. Browser at full screen, zoom 100%

### Browser Setup:
- **Open Tab 1:** http://localhost:5173 (Blossom app)
- **Open Tab 2:** https://sepolia.etherscan.io (for real-time tx verification)

---

## Demo Flow

### Opening (30 seconds)

> "Blossom is an intelligent execution layer for Web3. Instead of manually navigating protocols, approving tokens, and managing positions across multiple platforms, users simply tell Blossom what they want to do in natural language. Watch."

---

### Demo 1: Open a Perp Position (90 seconds)

**Say:** *"Let's say I'm bullish on ETH. Instead of going to a perps platform, I just ask:"*

**Type:**
```
Long ETH with 2% of my portfolio
```

**What Happens:**
1. AI analyzes current ETH price
2. Calculates position size (2% risk = ~$200 if $10k portfolio)
3. Sets smart take-profit (+15%) and stop-loss (-5%)
4. Shows execution plan

**Click:** "Execute Strategy"

**Show:**
- ✅ One transaction on Sepolia (ProofOfExecution adapter)
- ✅ Position appears instantly in right panel
- ✅ Portfolio updates in real-time

**Say:** *"That's it. One natural language command, one transaction, position is live."*

**Investor Insight:** *"On mainnet, this would route to the best perps venue - Hyperliquid, GMX, or dYdX - with the best liquidity and lowest fees."*

---

### Demo 2: Bet on an Event Market (90 seconds)

**Say:** *"Blossom isn't just for trading. It understands prediction markets too."*

**Type:**
```
Bet $10 YES on Fed cutting rates in March 2025
```

**What Happens:**
1. AI searches Polymarket and Kalshi
2. Finds "Fed Rate Cut March 2025" event
3. Shows current odds (~62% YES)
4. Calculates potential payout

**Click:** "Execute Strategy"

**Show:**
- ✅ Transaction executes via ProofOfExecution
- ✅ Event position appears in portfolio
- ✅ Live odds from Polymarket

**Say:** *"Same experience, different asset class. Natural language, one click, done."*

**Investor Insight:** *"We're pulling live market data from Polymarket and Kalshi. On mainnet, we'll execute directly on their platforms."*

---

### Demo 3: Park Idle Capital into Yield (60 seconds)

**Say:** *"Let's put some idle USDC to work."*

**Type:**
```
Park 100 USDC into yield
```

**What Happens:**
1. AI selects DemoLendVault
2. Shows 5% APR (demo)
3. Explains the position

**Click:** "Execute Strategy"

**Show:**
- ✅ Two transactions: approve + deposit (if first time)
- ✅ DeFi position shows in portfolio
- ✅ USDC balance decreases, shares received

**Say:** *"In production, this would route to the highest-yield opportunity - Aave, Compound, or a Pendle PT."*

---

### Demo 4: Swap Tokens (45 seconds)

**Say:** *"Basic swaps work too, but smarter."*

**Type:**
```
Swap 50 USDC to WETH
```

**What Happens:**
1. AI calculates best route
2. Shows expected output
3. 1% slippage protection

**Click:** "Execute Strategy"

**Show:**
- ✅ Real swap via DemoSwapRouter on Sepolia
- ✅ Balances update instantly

**Investor Insight:** *"We're integrating dFlow for order flow optimization. This means better prices, less MEV, and kickbacks on large trades."*

---

### Key Differentiators to Emphasize

#### 1. **Session-Based Execution (One-Click)**
- User creates a session once (7-day expiry, spending limits)
- All subsequent trades execute with one click
- No repetitive MetaMask popups

#### 2. **Live Market Data**
- Real Polymarket/Kalshi event odds
- Live token prices
- Real protocol APRs

#### 3. **AI Explanation Before Execution**
- Every trade shows full breakdown
- Risk assessment built-in
- Users always in control

#### 4. **Multi-Venue Execution**
- Perps: Hyperliquid, GMX, dYdX (testnet: ProofOfExecution)
- Events: Polymarket, Kalshi (testnet: ProofOfExecution)
- DeFi: Aave, Compound, Pendle (testnet: DemoLendVault)
- Swaps: 1inch, Uniswap, dFlow (testnet: DemoSwapRouter)

---

## Closing (60 seconds)

### Show Portfolio Overview

**Say:** *"Here's what we just did in 5 minutes:"*

**Point to Right Panel:**
- 1 perp position (ETH-USD Long)
- 1 event market bet (Fed Rate Cut)
- 1 DeFi position (100 USDC @ 5% APR)
- Updated token balances

**Final Statement:**

> "This is Blossom: One interface, one wallet, natural language, all of Web3. No more protocol hopping. No more manual transaction signing. Just tell us what you want to do, and we'll execute it optimally across the entire ecosystem."

---

## Q&A Preparation

### Common Questions

**Q: How do you make money?**
> "Execution fees (0.1-0.3% per trade), order flow optimization kickbacks from dFlow, and premium features like advanced analytics and auto-rebalancing."

**Q: What's your unfair advantage?**
> "We're infrastructure, not a protocol. We integrate with everything - perps, lending, swaps, prediction markets - and optimize execution across all of them. Nobody else does this."

**Q: Why would users trust you with their money?**
> "Session permissions are on-chain and user-controlled. 7-day expiry, spending limits, revocable anytime. Users never give us custody - just execution rights."

**Q: What's the path to mainnet?**
> "We're 85% there. Testnet proves the UX. Mainnet requires integrating real venue adapters (Hyperliquid, Polymarket CTF, Aave) and multi-chain support. 6-8 weeks."

**Q: Who's your customer?**
> "Power users who trade across multiple protocols (DeFi, perps, events). Early adopters who value speed and simplicity. Eventually: anyone who wants to use Web3 without learning it."

---

## Technical Notes (For Technical Questions)

### Architecture:
- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + Gemini AI
- **Contracts:** Solidity 0.8.25 (Foundry)
- **Chain:** Sepolia testnet (mainnet-ready)

### Smart Contracts:
- `ExecutionRouter` - Central hub for all trades
- `ProofOfExecutionAdapter` - Records intent for perps/events
- `DemoSwapRouter` - Real on-chain swaps (95% fixed demo rate)
- `DemoLendVault` - Real on-chain deposits (1:1 shares)

### Key Metrics:
- **Latency:** <2s from prompt to execution plan
- **Gas Cost:** ~0.001 ETH per transaction (Sepolia)
- **Session Security:** 7-day expiry, 10 ETH max spend limit

---

## Backup Demos (If Something Fails)

### If Testnet RPC is Down:
> "Let me show you the simulation mode we use for demos." (Switch `EXECUTION_MODE=sim` in backend and restart)

### If Wallet Won't Connect:
> "This is a known MetaMask quirk. In production, we support WalletConnect and Safe wallets too."

### If Transaction Fails:
> "Testnet can be flaky. Let me show you the execution logs." (Open browser console, show the plan structure)

---

## Post-Demo Follow-Up

### What to Send:
1. Link to live testnet: https://your-testnet-url.fly.dev
2. MVP_USER_TEST_GUIDE.md (so they can try it themselves)
3. ARCHITECTURE.md (technical deep-dive)
4. bloomoverview.md (high-level vision)

### Call-to-Action:
> "We're raising a seed round to take this to mainnet. Would love to have you as part of the journey. When can we schedule a deeper technical dive?"

---

**Remember:** Confidence. Speed. Clarity. Show, don't tell.
