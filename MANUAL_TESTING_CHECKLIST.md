# Blossom MVP Manual Testing Checklist

This checklist covers manual verification steps for the Blossom testnet MVP.

## Prerequisites

- [ ] MetaMask installed and configured for Sepolia testnet
- [ ] Phantom wallet installed for Solana testing
- [ ] Backend running locally (`npm run dev:agent`) or deployed to Fly.io
- [ ] Frontend running locally (`npm run dev`) or deployed to Vercel

## 1. Basic Page Load & Navigation

### 1.1 Landing Page
- [ ] Page loads without console errors
- [ ] Demo Mode banner displays (amber, testnet warning)
- [ ] Faucet links in banner are clickable
- [ ] BETA badge visible in header
- [ ] Navigation elements render properly

### 1.2 Wallet Connection
- [ ] "Connect Wallet" button visible when disconnected
- [ ] MetaMask prompt appears on click
- [ ] Wallet address displays after connection
- [ ] Switching accounts updates UI
- [ ] Disconnecting clears wallet state

### 1.3 Multi-Chain Wallet
- [ ] Both EVM and Solana wallet buttons visible
- [ ] Can connect MetaMask (Sepolia)
- [ ] Can connect Phantom (Solana Devnet)
- [ ] Wallet states display independently
- [ ] Chain badges show correct network

## 2. Token Minting (bUSDC)

### 2.1 Mint Flow
- [ ] "Mint bUSDC" button accessible after wallet connection
- [ ] Input field accepts numeric values
- [ ] Amount validation (min 0, max 1000)
- [ ] Transaction confirmation in MetaMask
- [ ] Success toast appears after minting
- [ ] Balance updates in portfolio

### 2.2 Rate Limiting
- [ ] Rapid mint attempts get rate limited (429 response)
- [ ] Daily cap warning appears when limit approached
- [ ] Clear error message when limit exceeded

## 3. Chat & Intent Parsing

### 3.1 Basic Chat
- [ ] Chat input field is focusable
- [ ] Can type and submit messages
- [ ] AI response appears in chat history
- [ ] Messages are scrollable
- [ ] Input clears after sending

### 3.2 Intent Recognition
Test these prompts and verify correct parsing:

| Prompt | Expected Action | Expected Fields |
|--------|-----------------|-----------------|
| "Swap 100 USDC for ETH" | swap | sourceAsset: USDC, targetAsset: ETH |
| "Long BTC with 10x leverage" | perp_long | asset: BTC, leverage: 10 |
| "Short ETH with $500" | perp_short | asset: ETH, amount: 500 |
| "Deposit $200 into lending" | deposit | venue: lending, amount: 200 |
| "Bet $50 on BTC above 100k" | event | type: bet, amount: 50 |

### 3.3 Error Handling
- [ ] Invalid prompt shows helpful error
- [ ] Rate-limited response is graceful
- [ ] Network error displays retry option

## 4. Execution Flow

### 4.1 Execution Mode Selection
- [ ] Three modes visible: Direct, One-Click, Confirm
- [ ] Mode selection persists across sessions
- [ ] Mode badge updates in header
- [ ] Tooltip explains each mode

### 4.2 Direct Signing Mode
- [ ] Transaction details shown before signing
- [ ] MetaMask prompt for each transaction
- [ ] Success confirmation after signing
- [ ] Transaction hash displayed
- [ ] Failure shows clear error message

### 4.3 One-Click (Session) Mode
- [ ] Session creation flow works
- [ ] Spend limit clearly shown
- [ ] Duration countdown visible
- [ ] Execution proceeds without wallet popup
- [ ] Session revocation works

### 4.4 Confirm Mode
- [ ] Plan review card displays before execution
- [ ] All details visible (asset, amount, fees)
- [ ] Confirm button triggers execution
- [ ] Reject button cancels without action
- [ ] Risk warnings visible when applicable

## 5. Portfolio Display

### 5.1 Portfolio Panel
- [ ] Total balance displays correctly
- [ ] Position breakdown visible
- [ ] Chain indicator for each asset
- [ ] Profit/loss colors correct (green/red)
- [ ] Refresh updates values

### 5.2 Cross-Chain View
- [ ] Ethereum positions display
- [ ] Solana positions display (if applicable)
- [ ] Aggregated total is correct
- [ ] Chain filter works

## 6. Security Verification

### 6.1 XSS Protection
Test these inputs in chat (should be escaped, not executed):
- [ ] `<script>alert('xss')</script>` - displays as text
- [ ] `<img onerror="alert(1)" src="x">` - displays as text
- [ ] `javascript:alert(1)` - not executed

### 6.2 Session Enforcement
- [ ] Modal appears when session required but not created
- [ ] Cannot bypass by refreshing
- [ ] Creating session dismisses modal
- [ ] Session expiry triggers modal reappearance

### 6.3 Network Validation
- [ ] Wrong network shows warning banner
- [ ] Execution blocked on wrong network
- [ ] Clear instruction to switch networks

## 7. UI/UX Quality

### 7.1 Responsive Design
Test on different viewport widths:
- [ ] Desktop (1920px) - full layout
- [ ] Laptop (1366px) - adjusted panels
- [ ] Tablet (768px) - stacked layout
- [ ] Mobile (375px) - single column

### 7.2 Accessibility
- [ ] All buttons have visible focus states
- [ ] Tab navigation works logically
- [ ] Contrast ratios are readable
- [ ] No text below 12px

### 7.3 Theme
- [ ] Light mode displays correctly
- [ ] Dark mode displays correctly (if available)
- [ ] Theme preference persists
- [ ] No flash on theme switch

## 8. Error States & Edge Cases

### 8.1 Network Errors
- [ ] Offline state handled gracefully
- [ ] Backend timeout shows retry option
- [ ] RPC errors show clear message

### 8.2 Wallet Errors
- [ ] Rejected transaction shows "Cancelled"
- [ ] Insufficient funds shows balance
- [ ] Gas estimation failure is caught

### 8.3 Session Errors
- [ ] Expired session prompts renewal
- [ ] Revoked session shows clear state
- [ ] Spend limit exceeded shows warning

## 9. Telemetry & Monitoring

### 9.1 Stats Collection
- [ ] Executions appear in telemetry dashboard
- [ ] Chain metrics are accurate
- [ ] Venue breakdown shows correctly
- [ ] Privacy-hashed wallet IDs only

### 9.2 Error Tracking
- [ ] Sentry receives errors (check dashboard)
- [ ] Error context includes relevant info
- [ ] No sensitive data in error reports

## 10. Cross-Browser Compatibility

Test on:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

## Sign-Off

**Tester**: _______________________

**Date**: _______________________

**Environment**: [ ] Local [ ] Staging [ ] Production

**Overall Status**: [ ] PASS [ ] FAIL

**Notes**:
```
_________________________________________________
_________________________________________________
_________________________________________________
```

## Issues Found

| Issue # | Description | Severity | Status |
|---------|-------------|----------|--------|
| | | | |
| | | | |
| | | | |

---

*Last Updated: February 5, 2026*
