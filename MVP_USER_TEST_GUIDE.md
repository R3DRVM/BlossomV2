# Blossom MVP - User Testing Guide

**Version:** Testnet V1 (January 2026)
**Goal:** Test AI-powered execution for DeFi, Perps, and Event Markets on Sepolia

---

## Prerequisites

### What You Need
1. **MetaMask** with Sepolia testnet configured
2. **Sepolia ETH** (~0.1 ETH for gas) - Get from [Sepolia Faucet](https://sepoliafaucet.com/)
3. **Demo Tokens** (DEMO_USDC, DEMO_WETH) - Auto-minted when you first interact

### Wallet Setup
- **Network:** Sepolia Testnet
- **Chain ID:** 11155111
- **RPC URL:** `https://sepolia.infura.io/v3/YOUR_KEY` (or use MetaMask's default)

---

## Starting the Application

### Step 1: Start Backend (Terminal 1)
```bash
cd agent
npm install  # First time only
npm run dev
```

**Expected Output:**
```
🔧 ETH Testnet Execution Configuration
   Router: 0xA31E1C...
   Mode: eth_testnet
   Auth: direct
✅ Blossom agent listening on port 3001
```

### Step 2: Start Frontend (Terminal 2)
```bash
npm install  # First time only
npm run dev
```

**Expected Output:**
```
VITE v5.x.x  ready in XXX ms
➜  Local:   http://localhost:5173/
```

### Step 3: Open Browser
Navigate to: **http://localhost:5173**

---

## Testing the MVP

### Test 1: Connect Wallet & Enable One-Click Execution

#### Actions:
1. Click **"Connect Wallet"** in top right
2. Approve MetaMask connection
3. Click **"Enable One-Click Execution"** button
4. Sign session creation transaction in MetaMask
5. Wait for confirmation

#### Expected Results:
- ✅ Wallet address shown in top right
- ✅ "One-Click Execution: Active" indicator
- ✅ Balance displays: ETH, DEMO_USDC, DEMO_WETH

---

### Test 2: Open a Perp Position (Natural Language)

#### Prompt:
```
Long ETH with 2% of my portfolio
```

#### What Should Happen:
1. AI analyzes your request
2. Shows execution plan with:
   - Market: ETH-USD
   - Side: Long
   - Risk: 2%
   - Entry price
   - Take profit / Stop loss
3. Click **"Execute Strategy"**
4. Transaction submits automatically (one-click)
5. See Sepolia explorer link: `https://sepolia.etherscan.io/tx/0x...`
6. **Right panel updates** showing new perp position

#### Verify:
- [ ] ProofOfExecution transaction confirmed
- [ ] Position appears in "Open Positions" panel
- [ ] Portfolio value updated

---

### Test 3: Deposit into DeFi Vault (Natural Language)

#### Prompt:
```
Park 100 USDC into yield
```

#### What Should Happen:
1. AI creates lending plan
2. Shows:
   - Protocol: DemoLendVault
   - Amount: 100 USDC
   - Est. APR: 5% (demo)
3. Click **"Execute Strategy"**
4. Approve USDC spending (if first time)
5. Deposit transaction executes
6. See explorer link

#### Verify:
- [ ] Two transactions if first time (approve + deposit)
- [ ] One transaction if already approved
- [ ] DeFi position appears in portfolio
- [ ] USDC balance decreased

---

### Test 4: Bet on Event Market (Natural Language)

#### Prompt:
```
Bet $10 YES on Fed cutting rates in March 2025
```

or

```
Bet $5 on Trump winning 2024 election (YES)
```

#### What Should Happen:
1. AI finds matching event from Polymarket/Kalshi
2. Shows:
   - Event: Fed Rate Cut March 2025
   - Side: YES
   - Stake: $10
   - Current odds: ~62%
3. Click **"Execute Strategy"**
4. Transaction executes
5. See ProofOfExecution on Sepolia

#### Verify:
- [ ] Event position appears in portfolio
- [ ] Transaction confirmed on Sepolia
- [ ] Portfolio updated with position

---

### Test 5: Swap Tokens (Natural Language)

#### Prompt:
```
Swap 50 USDC to WETH
```

#### What Should Happen:
1. AI creates swap plan
2. Shows:
   - From: 50 DEMO_USDC
   - To: ~X DEMO_WETH
   - Route: DemoSwapRouter
   - Expected slippage: <1%
3. Click **"Execute Strategy"**
4. Swap executes via DemoSwapRouter
5. See real swap transaction on Sepolia

#### Verify:
- [ ] DEMO_USDC balance decreased
- [ ] DEMO_WETH balance increased
- [ ] Transaction shows on Sepolia
- [ ] Routing metadata shown in chat

---

## Common Issues & Fixes

### Issue: "Insufficient balance"
**Fix:** Request more demo tokens:
```bash
cd contracts
RECIPIENT_ADDRESS=<your_wallet> forge script script/MintDemoTokens.s.sol:MintDemoTokens --rpc-url <sepolia_rpc> --private-key <deployer_key> --broadcast
```

### Issue: "Session not found"
**Fix:** Re-enable one-click execution (session may have expired after 7 days)

### Issue: "Transaction failed"
**Check:**
1. Do you have Sepolia ETH for gas?
2. Is the backend running?
3. Check browser console for errors (F12)

### Issue: Backend won't start
**Check:**
1. `agent/.env.local` exists and has all contract addresses
2. Port 3001 is not in use: `lsof -i :3001`
3. Node version: `node -v` (need v18+)

### Issue: Wallet won't connect
**Fix:**
1. Switch MetaMask to Sepolia
2. Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)

---

## What Makes This a Good Demo?

### For Non-Technical Users:
- Natural language input (no need to understand protocols)
- One-click execution (no manual transaction signing per action)
- AI explains every trade before executing
- Live market data from Polymarket/Kalshi

### For Technical Users:
- Real on-chain execution (Sepolia)
- ProofOfExecution adapter for perps/events (future: real venue integration)
- Real swap/lending via demo contracts
- Session-based permissions (7-day expiry, spending limits)
- Full transaction history on Sepolia explorer

---

## Testing Checklist

Before showing to investors, verify:

- [ ] All 5 test scenarios complete successfully
- [ ] Portfolio updates after each execution
- [ ] Sepolia explorer links work
- [ ] One-click session remains active across multiple trades
- [ ] AI provides clear explanations for each strategy
- [ ] Error messages are user-friendly
- [ ] Page loads in <2 seconds
- [ ] No console errors in browser (F12)

---

## Next Steps After MVP Testing

1. **Mainnet Preparation:**
   - Integrate real perps venue (Hyperliquid, GMX, dYdX)
   - Integrate real Polymarket CTF adapter
   - Add multi-chain support (Arbitrum, Polygon)

2. **UX Polish:**
   - Add loading states during transaction
   - Show pending transactions
   - Add transaction history view

3. **Safety Features:**
   - Position size limits
   - Risk warnings for high-leverage trades
   - Portfolio health monitoring

---

## Support

For issues or questions:
- Check backend logs: Terminal running `npm run dev` in `agent/`
- Check frontend logs: Browser console (F12)
- Review Sepolia transactions: `https://sepolia.etherscan.io/address/<your_wallet>`

**Remember:** This is testnet. All tokens are worthless. Feel free to experiment!
