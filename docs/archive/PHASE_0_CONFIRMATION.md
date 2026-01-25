# Phase 0: Read-Only Confirmation Checklist

## ✅ 1. LLM Client Provider Selection

**File:** `agent/src/services/llmClient.ts`

**Current State:**
- ✅ Line 21-27: `getProvider()` reads `BLOSSOM_MODEL_PROVIDER` from env
- ✅ Line 22: Supports 'openai', 'anthropic', 'gemini', 'stub'
- ✅ Line 34: Logs provider name: `[llmClient] Using provider: <provider>`
- ⚠️ Line 158-160: Gemini throws error if key missing (should fall back to stub)

**Gemini Env Vars:**
- ✅ `BLOSSOM_GEMINI_API_KEY` - Read from `process.env` (server-side only)
- ✅ `BLOSSOM_GEMINI_MODEL` - Default: 'gemini-1.5-pro'

**Action Needed:** Fix fallback to stub if Gemini key missing

---

## ✅ 2. Frontend → Backend Flow

**Current State:**
- ✅ User message → `POST /api/chat` (line 168 in http.ts)
- ✅ Plan generation → `callLlm()` → `parseModelResponse()` (lines 246-251)
- ✅ Execution prepare → `POST /api/execute/prepare` (exists)
- ✅ Submit → `POST /api/execute/submit` (exists)
- ✅ Status polling → `GET /api/execute/status` (exists)
- ✅ Portfolio refresh → `GET /api/portfolio/eth_testnet` (exists, polled every 15s)

**Flow is complete and working.**

---

## ✅ 3. Demo Parity - Balance Mocking

**Current State:**
- ✅ **Sim Mode:** Uses `INITIAL_BALANCES` (line 240-244 in BlossomContext.tsx)
  - REDACTED: 4000, ETH: 3000, SOL: 3000
  - Account value: 10000
- ✅ **Testnet Mode:** Bypasses mocks via portfolio sync (lines 1386-1491)
  - Condition: `executionMode === 'eth_testnet'`
  - Fetches real balances from `/api/portfolio/eth_testnet`
  - Merges with simulated balances (preserves DEFI positions)
  - Updates every 15s

**Demo parity is preserved. Testnet mode uses real balances.**

---

## ✅ Safety Confirmation

- ✅ Gemini key only read from `process.env` (server-side)
- ✅ No logging of API keys
- ✅ No .env files committed
- ✅ Frontend never sees API keys
- ⚠️ Need to add fallback to stub if key missing (instead of throwing error)

---

## ✅ Proceed to Phase 1

**Status:** Safe to proceed. Only fix needed: Gemini fallback to stub.

