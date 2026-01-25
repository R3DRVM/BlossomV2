# Manual Investor Test Script

**Purpose:** Step-by-step click path for testing all investor demo flows.

**Prerequisites:**
- Backend running at http://localhost:3001
- Frontend running at http://localhost:5173
- MetaMask installed with Sepolia network
- Test wallet funded with Sepolia ETH + Demo tokens

---

## Pre-Test Verification

### 1. Check Backend Health

```bash
curl http://localhost:3001/health
```

**Expected:** `{"status":"ok"}`

### 2. Run Preflight

```bash
curl http://localhost:3001/api/execute/preflight | jq '.ok'
```

**Expected:** `true`

---

## Test 1: Connect Wallet

### Steps

1. Open http://localhost:5173
2. Click "Connect Wallet" button in header
3. MetaMask popup appears
4. Select Sepolia network (if prompted)
5. Click "Connect" in MetaMask

### Expected UI Output

- Header shows truncated wallet address: `0x1234...5678`
- Network indicator shows "Sepolia"
- No error messages

### Verification

- Check browser console for: `[walletAdapter] Connected: 0x...`

---

## Test 2: Demo Swap (REDACTED → WETH)

### Steps

1. Type in chat: **"Swap 100 REDACTED to WETH"**
2. Wait for AI response with strategy card
3. Review strategy card shows:
   - Token: REDACTED → WETH
   - Amount: 100 REDACTED
   - Expected output (approximately 0.95 WETH with demo rate)
4. Click **"Confirm & Execute"**
5. If prompted for approval:
   - MetaMask shows "Approve DEMO_REDACTED" tx
   - Confirm in MetaMask
   - Wait for approval confirmation
6. MetaMask shows execution tx
7. Confirm in MetaMask
8. Wait for transaction to mine

### Expected UI Output

- Strategy card status changes: `pending` → `executing` → `executed`
- Assistant message appears with:
  ```
  Routing decision: REDACTED → WETH via [1inch/deterministic]
  Expected out: 0.95 WETH
  Executed on Sepolia via Blossom ExecutionRouter.
  Tx: https://sepolia.etherscan.io/tx/0x...
  ```

### Etherscan Proof

1. Click the tx link in assistant message
2. Verify on Etherscan:
   - Status: Success
   - To: ExecutionRouter address
   - Method: `executeBySender`
   - Events: `ActionExecuted` with actionType 0 (SWAP)

### Verification Checklist

- [ ] Strategy card shows "executed" status
- [ ] Assistant message contains Etherscan link
- [ ] Etherscan shows successful tx
- [ ] Wallet WETH balance increased

---

## Test 3: Lending Supply (REDACTED to Vault)

### Steps

1. Type in chat: **"Supply 100 REDACTED to lending"**
2. Wait for AI response with DeFi card
3. Review card shows:
   - Protocol: DemoLendVault
   - APY: ~5% (informational)
   - Amount: 100 REDACTED
4. Click **"Confirm & Execute"**
5. If prompted for approval (first time only):
   - Confirm REDACTED approval in MetaMask
6. Confirm execution tx in MetaMask
7. Wait for transaction to mine

### Expected UI Output

- Strategy card status: `pending` → `executing` → `executed`
- Assistant message:
  ```
  Lending decision: Supply REDACTED to DemoLendVault
  Est APR: 5.00% (info-only)
  Executed on Sepolia via Blossom ExecutionRouter.
  Tx: https://sepolia.etherscan.io/tx/0x...
  ```

### Etherscan Proof

1. Click tx link
2. Verify on Etherscan:
   - Status: Success
   - Events: `ActionExecuted` with actionType 2 (PULL), 3 (LEND_SUPPLY)
   - Events: `Deposit` from DemoLendVault

### Verification Checklist

- [ ] Strategy card shows "executed" status
- [ ] Etherscan shows 2 ActionExecuted events (PULL + LEND_SUPPLY)
- [ ] DemoLendVault shows deposit event
- [ ] Vault shares balance increased (check via Etherscan)

---

## Test 4: Perps Strategy (Proof-of-Execution)

### Steps

1. Type in chat: **"Long ETH with 3x leverage, 3% risk"**
2. Wait for AI response with perps strategy card
3. Review card shows:
   - Market: ETH-USD (or similar)
   - Side: Long
   - Leverage: 3x
   - Risk: 3% of account
4. Click **"Confirm & Execute"**
5. Confirm tx in MetaMask
6. Wait for transaction to mine

### Expected UI Output

- Strategy card status: `pending` → `executing` → `executed`
- Assistant message:
  ```
  Perps execution (proof-of-execution):
  LONG ETH-USD @ 3x leverage (3% risk)
  On-chain proof recorded.
  Tx: https://sepolia.etherscan.io/tx/0x...
  ```

### Etherscan Proof

1. Click tx link
2. Verify on Etherscan:
   - Status: Success
   - Events: `ActionExecuted` with actionType 6 (PROOF)
   - Events: `ProofRecorded` with:
     - venueType: 1 (perps)
     - intentHash: 0x...
     - summary: "PERP:ETH-LONG-3x-3%"

### Verification Checklist

- [ ] Strategy card shows "executed" status
- [ ] Etherscan shows ProofRecorded event
- [ ] venueType = 1 (perps)
- [ ] summary matches trade parameters

---

## Test 5: Event Market Position (Proof-of-Execution)

### Steps

1. Type in chat: **"Buy YES on Fed rate cut, $50 stake"**
2. Wait for AI response with event market card
3. Review card shows:
   - Market: Fed rate cut (or similar)
   - Outcome: YES
   - Stake: $50
4. Click **"Confirm & Execute"**
5. Confirm tx in MetaMask
6. Wait for transaction to mine

### Expected UI Output

- Strategy card status: `pending` → `executing` → `executed`
- Assistant message:
  ```
  Event market execution (proof-of-execution):
  YES on fed-rate-cut ($50 stake)
  On-chain proof recorded.
  Tx: https://sepolia.etherscan.io/tx/0x...
  ```

### Etherscan Proof

1. Click tx link
2. Verify on Etherscan:
   - Status: Success
   - Events: `ProofRecorded` with:
     - venueType: 2 (event)
     - intentHash: 0x...
     - summary: "EVENT:fedcuts-YES-50USD"

### Verification Checklist

- [ ] Strategy card shows "executed" status
- [ ] Etherscan shows ProofRecorded event
- [ ] venueType = 2 (event)
- [ ] summary matches event parameters

---

## Test 6: Session Mode (Optional)

**Note:** Requires `EXECUTION_AUTH_MODE=session` in backend config.

### Steps

1. First execution: user signs session creation tx
2. User signs approval tx (one-time)
3. Subsequent executions: no wallet prompts

### Session Creation

1. Type: **"Swap 50 REDACTED to WETH"**
2. Click **"Confirm & Execute"**
3. MetaMask shows "Create Session" tx
4. Confirm in MetaMask
5. MetaMask shows approval tx (if needed)
6. Confirm in MetaMask
7. Transaction executes via relayer

### Subsequent Executions

1. Type: **"Swap 25 REDACTED to WETH"**
2. Click **"Confirm & Execute"**
3. **NO MetaMask popup** - tx is relayed
4. Wait for confirmation

### Verification

- [ ] First tx requires wallet signature
- [ ] Second tx: no wallet popup
- [ ] Both txs visible on Etherscan
- [ ] Relayer address is msg.sender on relayed tx

---

## Failure Recovery

### Transaction Fails On-Chain

**Symptom:** Strategy stays "pending", error message shown

**Actions:**
1. Check error message in chat
2. Common issues:
   - "insufficient allowance" → retry (approval failed)
   - "deadline exceeded" → wait and retry
   - "adapter not allowed" → redeploy contracts

### Receipt Timeout

**Symptom:** Message says "Tx pending; check link"

**Actions:**
1. Transaction may still confirm
2. Click link to check Etherscan
3. If confirmed, manually verify
4. If pending > 5 min, may need to speed up (add gas)

### Wallet Not Connecting

**Actions:**
1. Refresh page
2. Check MetaMask is on Sepolia
3. Try disconnecting and reconnecting
4. Check browser console for errors

---

## Success Criteria Summary

| Test | Key Verification |
|------|------------------|
| Connect Wallet | Address shown in header |
| Swap | Etherscan: ActionExecuted(SWAP) |
| Lending | Etherscan: ActionExecuted(PULL, LEND_SUPPLY) |
| Perps | Etherscan: ProofRecorded(venueType=1) |
| Events | Etherscan: ProofRecorded(venueType=2) |
| Session | Second tx: no wallet prompt |

---

## Quick Reference: Etherscan Event Search

To verify events on Etherscan:

1. Go to tx page
2. Click "Logs" tab
3. Look for:
   - `ActionExecuted(bytes32 planHash, uint256 index, uint8 actionType, address adapter)`
   - `ProofRecorded(address user, uint8 venueType, bytes32 intentHash, string summary, uint256 timestamp)`

### Action Type Values

| Type | Value | Description |
|------|-------|-------------|
| SWAP | 0 | Token swap |
| WRAP | 1 | ETH → WETH |
| PULL | 2 | Pull tokens from user |
| LEND_SUPPLY | 3 | Supply to lending |
| LEND_BORROW | 4 | Borrow from lending |
| EVENT_BUY | 5 | Event market buy |
| PROOF | 6 | Proof-of-execution |


