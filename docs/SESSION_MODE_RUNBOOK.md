# Session Mode Runbook

## Overview

Session mode allows users to create a one-time session that enables the backend relayer to execute plans on their behalf without requiring repeated wallet signatures. This provides a seamless UX where users can execute multiple swaps after a single session creation.

**Key Features:**
- One-time session creation (user signs once)
- Relayed execution (backend pays gas, user doesn't sign each tx)
- Supports Route 2 atomic funding routes (WRAP + SWAP in one plan)
- Strict server-side guards for safety

---

## Environment Variables

### Backend (.env)

```bash
# Execution mode
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=session

# Contract addresses
EXECUTION_ROUTER_ADDRESS=0x...
UNISWAP_V3_ADAPTER_ADDRESS=0x...
WETH_WRAP_ADAPTER_ADDRESS=0x...  # Required for Route 2
WETH_ADDRESS_SEPOLIA=0x...
REDACTED_ADDRESS_SEPOLIA=0x...

# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...

# Relayer (REQUIRED for session mode)
RELAYER_PRIVATE_KEY=0x...  # Wallet with Sepolia ETH for gas

# LLM (for chat)
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your_key
```

### Frontend (.env)

```bash
VITE_USE_AGENT_BACKEND=true
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=session
VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
VITE_FUNDING_ROUTE_MODE=atomic  # Optional: use Route 2 atomic funding
```

---

## Backend Endpoints

### POST /api/session/prepare

**Purpose:** Prepare session creation transaction

**Request:**
```json
{
  "userAddress": "0x..."
}
```

**Response:**
```json
{
  "sessionId": "0x...",
  "to": "0x...",
  "data": "0x...",
  "value": "0x0",
  "summary": "Create session for 0x7abFA1E1... with executor 0x..."
}
```

**Session Parameters:**
- `expiresAt`: 7 days from creation
- `maxSpend`: 10 ETH (configurable)
- `allowedAdapters`: UniswapV3SwapAdapter, WethWrapAdapter, MockSwapAdapter (if configured)

### POST /api/session/status

**Purpose:** Get session status (active/expired/revoked)

**Request:**
```json
{
  "userAddress": "0x...",
  "sessionId": "0x..."
}
```

**Response:**
```json
{
  "sessionId": "0x...",
  "status": "active",
  "owner": "0x...",
  "executor": "0x...",
  "expiresAt": "1234567890",
  "maxSpend": "10000000000000000000",
  "spent": "0",
  "active": true
}
```

### POST /api/session/revoke/prepare

**Purpose:** Prepare session revocation transaction

**Request:**
```json
{
  "sessionId": "0x..."
}
```

**Response:**
```json
{
  "to": "0x...",
  "data": "0x...",
  "value": "0x0",
  "summary": "Revoke session 0x..."
}
```

### POST /api/execute/relayed

**Purpose:** Execute plan using session permissions (relayed by backend)

**Request:**
```json
{
  "draftId": "draft-123",
  "userAddress": "0x...",
  "plan": {
    "user": "0x...",
    "nonce": "0",
    "deadline": "1234567890",
    "actions": [...]
  },
  "sessionId": "0x...",
  "value": "0x0"  // Required for WRAP actions
}
```

**Response:**
```json
{
  "txHash": "0x...",
  "chainId": 11155111,
  "explorerUrl": "https://sepolia.etherscan.io/tx/0x..."
}
```

**Server-Side Guards:**
1. Action count: max 4 actions
2. Allowed adapters only: UniswapV3SwapAdapter, WethWrapAdapter, MockSwapAdapter
3. Deadline: <= 10 minutes from now
4. Token allowlist: WETH, REDACTED only
5. Max amountIn per swap: 1 ETH
6. Max value: 1 ETH (for WRAP actions)

---

## Frontend UI Flow

### 1. Create Session

1. User clicks "Create Session" button
2. Frontend calls `/api/session/prepare`
3. MetaMask popup: User signs session creation transaction
4. Session ID stored in `localStorage` (`blossom_session_${userAddress}`)
5. Session status displayed in UI

### 2. Execute with Session

1. User sends chat message: "Swap 0.01 ETH to WETH on Sepolia"
2. Gemini returns `executionRequest` with `tokenIn: "ETH"`, `fundingPolicy: "auto"`
3. User clicks "Confirm Trade"
4. Frontend checks for active session:
   - If session exists: Use relayed execution
   - If no session: Create session first (then execute)
5. Backend prepares plan (may include WRAP + SWAP for Route 2)
6. Backend relays execution (no user signature needed)
7. Transaction hash returned, status polled

### 3. Revoke Session

1. User clicks "Revoke Session" button
2. Frontend calls `/api/session/revoke/prepare`
3. MetaMask popup: User signs revocation transaction
4. Session removed from `localStorage`
5. Session status updated to "revoked"

---

## E2E Testing

### Test Session + Route 2 Submit

```bash
cd agent

BLOSSOM_MODEL_PROVIDER=gemini \
BLOSSOM_GEMINI_API_KEY=your_key \
EXECUTION_MODE=eth_testnet \
EXECUTION_AUTH_MODE=session \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_WRAP_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
REDACTED_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
RELAYER_PRIVATE_KEY=0x... \
E2E_INTENT=session_funding_route_submit \
E2E_SUBMIT=1 \
TEST_SESSION_ID=0x... \  # Optional: use existing session
npm run e2e:sepolia
```

**Expected:**
- ✓ AI generates executionRequest for ETH-only scenario
- ✓ Plan includes WRAP as first action
- ✓ Plan includes SWAP as second action
- ✓ Relayed execution submitted
- ✓ Transaction confirmed

---

## Common Failure Triage

### 1. Nonce Issues

**Symptom:** Transaction fails with "nonce too low" or "nonce too high"

**Fix:**
- Check relayer wallet nonce: `cast nonce $RELAYER_ADDRESS --rpc-url $RPC`
- Ensure relayer wallet has sufficient ETH for gas
- Wait for pending transactions to confirm

### 2. Expired Session

**Symptom:** Relayed execution fails with "session expired"

**Fix:**
- Check session status: `POST /api/session/status`
- Create new session if expired
- Update `localStorage` with new session ID

### 3. Insufficient Relayer Funds

**Symptom:** Relayed execution fails with "insufficient funds"

**Fix:**
- Fund relayer wallet with Sepolia ETH
- Check balance: `cast balance $RELAYER_ADDRESS --rpc-url $RPC`
- Minimum recommended: 0.1 ETH

### 4. Adapter Not Allowed

**Symptom:** Relayed execution fails with "adapter not allowed"

**Fix:**
- Check session allowed adapters
- Ensure adapter is in session creation
- Verify adapter is in global allowlist

### 5. Plan Validation Failed

**Symptom:** Relayed execution fails with validation error

**Common causes:**
- Action count > 4
- Deadline too far in future (> 10 minutes)
- Token not in allowlist
- Amount exceeds max (1 ETH)

**Fix:**
- Check plan structure
- Verify tokens are WETH/REDACTED only
- Reduce amount if needed

---

## Security Considerations

1. **Relayer Private Key:**
   - Never commit to git
   - Store in secure env var only
   - Use separate wallet for production

2. **Session Scope:**
   - Max spend: 10 ETH (configurable)
   - Expiry: 7 days (configurable)
   - Allowed adapters: Only trusted adapters

3. **Server-Side Guards:**
   - All guards enforced before relaying
   - No plan execution outside scope
   - Clear error messages for rejections

4. **Token Approvals:**
   - Users must approve tokens before session execution
   - Approvals are per-token, not unlimited
   - Router pulls tokens from user (not relayer)

---

## Manual Verification Checklist

### MetaMask Verification

1. **Create Session:**
   - [ ] Click "Create Session"
   - [ ] MetaMask popup shows session creation transaction
   - [ ] Transaction succeeds
   - [ ] Session status shows "Active"

2. **Execute with Session (Route 2):**
   - [ ] Send: "Swap 0.01 ETH to WETH on Sepolia"
   - [ ] Click "Confirm Trade"
   - [ ] **No MetaMask popup** (relayed execution)
   - [ ] Transaction hash returned
   - [ ] Transaction confirmed on Sepolia

3. **Verify Transaction:**
   - [ ] Check Sepolia explorer
   - [ ] Transaction shows relayer as sender
   - [ ] Transaction includes WRAP + SWAP actions
   - [ ] Transaction value > 0 (for WRAP)

4. **Revoke Session:**
   - [ ] Click "Revoke Session"
   - [ ] MetaMask popup shows revocation transaction
   - [ ] Transaction succeeds
   - [ ] Session status shows "Revoked"

---

## Troubleshooting

### Session Not Found

- Check `localStorage` for `blossom_session_${userAddress}`
- Verify session exists on-chain: `POST /api/session/status`
- Create new session if missing

### Relayed Execution Fails

- Check relayer wallet balance
- Verify session is active
- Check server logs for guard failures
- Ensure plan passes all validation checks

### Route 2 Not Working

- Verify `WETH_WRAP_ADAPTER_ADDRESS` is set
- Check `VITE_FUNDING_ROUTE_MODE=atomic` (optional)
- Ensure `executionRequest.tokenIn === "ETH"` and `fundingPolicy === "auto"`

---

## Next Steps

1. **Deploy contracts** (if not already deployed)
2. **Set environment variables** (backend + frontend)
3. **Fund relayer wallet** with Sepolia ETH
4. **Test session creation** in UI
5. **Test relayed execution** with Route 2
6. **Verify transactions** on Sepolia explorer


