# AI Agent Flow: Gemini → Plan → Execution

## Overview

Blossom uses Gemini as the primary AI agent to generate trading plans from natural language, then executes them on-chain via the ExecutionRouter.

---

## Flow Diagram

```
User Message (UI)
    ↓
POST /api/chat
    ↓
callLlm() → Gemini API
    ↓
Parse JSON Response → BlossomAction[]
    ↓
Validate Actions
    ↓
User Confirms
    ↓
POST /api/execute/prepare
    ↓
EIP-712 Typed Data
    ↓
User Signs (MetaMask)
    ↓
POST /api/execute/submit
    ↓
GET /api/execute/status (polling)
    ↓
Portfolio Refresh (/api/portfolio/eth_testnet)
```

---

## Key Components

### 1. LLM Client (`agent/src/services/llmClient.ts`)

**Provider Selection:**
- Reads `BLOSSOM_MODEL_PROVIDER` from env (default: 'stub')
- Supports: 'gemini', 'openai', 'anthropic', 'stub'
- Falls back to stub if API key missing

**Gemini Configuration:**
- `BLOSSOM_GEMINI_API_KEY` - Required for Gemini
- `BLOSSOM_GEMINI_MODEL` - Default: 'gemini-1.5-pro'

**Security:**
- API key only read from `process.env` (server-side)
- Never logged or persisted
- Falls back to stub if key missing (no error thrown)

---

### 2. Chat Endpoint (`agent/src/server/http.ts`)

**Route:** `POST /api/chat`

**Input:**
```json
{
  "userMessage": "Swap 50 REDACTED for WETH",
  "venue": "hyperliquid",
  "clientPortfolio": { ... }
}
```

**Flow:**
1. Build prompts from user message + portfolio
2. Call `callLlm()` → Gemini generates JSON
3. Parse JSON → `BlossomAction[]`
4. Validate actions
5. Apply to sims (for demo mode)
6. Return response

**Output:**
```json
{
  "assistantMessage": "I'll swap 50 REDACTED for WETH...",
  "actions": [
    {
      "type": "defi",
      "action": "deposit",
      ...
    }
  ],
  "portfolio": { ... }
}
```

---

### 3. Execution Flow

**Prepare:** `POST /api/execute/prepare`
- Takes `executionIntent` (e.g., 'swap_usdc_weth')
- Builds EIP-712 typed data
- Returns transaction payload

**Submit:** `POST /api/execute/submit`
- Records transaction hash
- Returns success

**Status:** `GET /api/execute/status?txHash=0x...`
- Polls transaction status
- Returns: 'pending', 'confirmed', 'reverted'

---

## Demo Parity

### Sim Mode (Default)
- Uses `INITIAL_BALANCES` (mocked)
- AI generates plans
- Plans applied to sims
- No on-chain execution

### Testnet Mode (`VITE_EXECUTION_MODE=eth_testnet`)
- Uses real balances from `/api/portfolio/eth_testnet`
- AI generates plans
- Plans prepared for on-chain execution
- User signs transactions
- Real execution on Sepolia

**Key:** Demo UX is identical, only execution target changes.

---

## Verification

### Check Provider
```bash
curl http://localhost:3002/health | jq
# Returns: { "status": "ok", "service": "blossom-agent", "llmProvider": "gemini" }
```

### Test AI Generation
```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Swap 50 REDACTED for WETH","venue":"hyperliquid"}' | jq
```

**Expected:**
- `assistantMessage` contains AI-generated text
- `actions` array contains structured plan
- Response is contextual and relevant

---

## Security Guarantees

1. **API Key Security:**
   - Only read from `process.env` (server-side)
   - Never logged or persisted
   - Never sent to frontend
   - Falls back to stub if missing

2. **Execution Safety:**
   - All plans require user confirmation
   - EIP-712 signature verification
   - Nonce-based replay protection
   - Adapter allowlist enforcement

3. **Demo Parity:**
   - Sim mode uses mocks (no on-chain)
   - Testnet mode uses real execution
   - UX is identical in both modes

---

## Troubleshooting

**Gemini not responding:**
- Check: `BLOSSOM_MODEL_PROVIDER=gemini` set?
- Check: `BLOSSOM_GEMINI_API_KEY` set?
- Verify: `/health` shows `llmProvider: "gemini"`

**Plans not generating:**
- Check: Backend logs for `[llmClient] Using provider: ...`
- Check: API key is valid
- Check: Network connectivity to Gemini API

**Execution fails:**
- Check: Preflight returns `ok: true`
- Check: User has sufficient balances
- Check: Adapter is allowlisted

---

**Status:** Gemini is wired end-to-end. AI generates plans, user confirms, execution happens on-chain.

