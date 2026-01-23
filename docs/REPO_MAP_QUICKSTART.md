# Blossom Repository Map - Quick Start Guide

**For**: New engineers, quick triage, deployment troubleshooting

---

## If You Are New, Do This

1. **Read the main README**: `README.md` (project overview, getting started)

2. **Install dependencies**:
   ```bash
   npm run install:all
   ```

3. **Start in mock mode** (no backend needed):
   ```bash
   npm run dev
   # Open http://localhost:5173
   # Try: "Long ETH with 3% risk"
   ```

4. **Enable backend mode** (optional, for live prices/LLM):
   ```bash
   # Create .env.local at root:
   echo "VITE_USE_AGENT_BACKEND=true" > .env.local
   echo "VITE_AGENT_API_URL=http://localhost:3001" >> .env.local
   
   # Start backend:
   cd agent && npm run dev:agent
   
   # In another terminal, start frontend:
   npm run dev
   ```

5. **Run verification** (checks everything):
   ```bash
   ./scripts/mvp-verify.sh --start-backend
   ```

6. **Explore the codebase**:
   - Frontend entry: `src/components/Chat.tsx`
   - Backend entry: `agent/src/server/http.ts`
   - Mock parser: `src/lib/mockParser.ts` (fallback when backend unavailable)

7. **Understand the flow**:
   - User types → `Chat.tsx` → `blossomApi.ts` → Backend `/api/chat` → LLM → Actions → Execution plan

8. **Check canonical docs**:
   - MVP requirements: `docs/V1_MVP_REQUIREMENTS.md`
   - Session mode: `docs/SESSION_MODE_AUDIT.md`
   - Deployment: `docs/TESTNET_MVP_STATUS.md`

9. **Run E2E tests** (if backend running):
   ```bash
   npx playwright test
   ```

10. **Deploy to Sepolia** (if needed):
    ```bash
    cd contracts
    export SEPOLIA_RPC_URL="..."
    export DEPLOYER_PRIVATE_KEY="0x..."
    ./scripts/deploy-sepolia.sh
    ```

---

## If Demo Is Broken, Check This First

### 1. Backend Not Running
**Symptom**: Frontend shows "Backend Offline" or API calls fail

**Check**:
```bash
curl http://localhost:3001/health
# Should return: {"ok": true, "ts": ...}
```

**Fix**:
```bash
cd agent && npm run dev:agent
# Or use auto-start:
./scripts/mvp-verify.sh --start-backend
```

### 2. Frontend Not Building
**Symptom**: `npm run dev` fails or build errors

**Check**:
```bash
npm run build
# Look for TypeScript errors
```

**Fix**:
- Check `tsconfig.json` excludes (should exclude `_suddengreencard`)
- Check `package.json` dependencies are installed
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`

### 3. Mock Mode Not Working
**Symptom**: Chat doesn't respond or shows errors

**Check**:
- Is `src/lib/mockParser.ts` present? (should be)
- Check browser console for errors
- Verify `Chat.tsx` imports `mockParser.ts`

**Fix**:
- Frontend should work without backend (mock mode)
- If not, check `src/lib/config.ts` for `USE_AGENT_BACKEND` flag

### 4. LLM Not Responding
**Symptom**: Backend returns stub responses or errors

**Check**:
```bash
# Check agent/.env:
cat agent/.env | grep BLOSSOM_MODEL_PROVIDER
```

**Fix**:
- Set `BLOSSOM_MODEL_PROVIDER=stub` (no API keys needed)
- Or set `BLOSSOM_MODEL_PROVIDER=openai` + `BLOSSOM_OPENAI_API_KEY=...`
- Or set `BLOSSOM_MODEL_PROVIDER=anthropic` + `BLOSSOM_ANTHROPIC_API_KEY=...`
- Or set `BLOSSOM_MODEL_PROVIDER=gemini` + `BLOSSOM_GEMINI_API_KEY=...`

### 5. Portfolio Not Syncing
**Symptom**: Portfolio shows stale data or doesn't update

**Check**:
```bash
curl http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x...
# Should return portfolio data
```

**Fix**:
- Backend must be running
- Check `EXECUTION_MODE=eth_testnet` in `agent/.env` (for real balances)
- Or use simulation mode (no backend needed, local state)

### 6. Execution Not Working
**Symptom**: "Confirm & Execute" button doesn't work or transactions fail

**Check**:
```bash
curl -X POST http://localhost:3001/api/execute/preflight
# Should return: {"ok": true, ...}
```

**Fix**:
- For Sepolia: Check `EXECUTION_MODE=eth_testnet`, `ETH_TESTNET_RPC_URL`, contract addresses
- For simulation: Should work without backend (mock mode)
- Check wallet connection (MetaMask) if using Sepolia

### 7. Session Mode Not Working
**Symptom**: Session creation fails or relayer errors

**Check**:
```bash
# Check env vars:
echo $EXECUTION_AUTH_MODE  # Should be "session"
echo $RELAYER_PRIVATE_KEY   # Should be set (0x...)
```

**Fix**:
- Set `EXECUTION_AUTH_MODE=session` in `agent/.env`
- Set `RELAYER_PRIVATE_KEY=0x...` (wallet with Sepolia ETH for gas)
- Restart backend after changing env vars

---

## If Sepolia Deploy Fails, Check This

### 1. Contract Deployment Fails
**Symptom**: `./contracts/scripts/deploy-sepolia.sh` fails

**Check**:
```bash
# Required env vars:
echo $SEPOLIA_RPC_URL        # Should be set
echo $DEPLOYER_PRIVATE_KEY   # Should be set (0x...)
```

**Fix**:
- Set `SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"` (or Alchemy, etc.)
- Set `DEPLOYER_PRIVATE_KEY="0x..."` (wallet with Sepolia ETH for deployment gas)
- Check RPC URL is accessible: `curl $SEPOLIA_RPC_URL` (should return JSON-RPC response)

### 2. Contracts Don't Verify
**Symptom**: Deployment succeeds but contracts aren't on-chain

**Check**:
```bash
# Check contract addresses in output:
# Should see: EXECUTION_ROUTER_ADDRESS=0x...
# Should see: MOCK_SWAP_ADAPTER_ADDRESS=0x...
```

**Fix**:
- Copy addresses to `agent/.env`:
  ```bash
  EXECUTION_ROUTER_ADDRESS=0x...
  MOCK_SWAP_ADAPTER_ADDRESS=0x...
  ETH_TESTNET_RPC_URL=$SEPOLIA_RPC_URL
  EXECUTION_MODE=eth_testnet
  ```
- Verify on Sepolia Etherscan: `https://sepolia.etherscan.io/address/0x...`

### 3. Preflight Check Fails
**Symptom**: `curl http://localhost:3001/api/execute/preflight` returns `{"ok": false}`

**Check**:
```bash
# Check backend env vars:
cat agent/.env | grep -E "EXECUTION_ROUTER_ADDRESS|MOCK_SWAP_ADAPTER_ADDRESS|ETH_TESTNET_RPC_URL"
```

**Fix**:
- Set all required env vars in `agent/.env`:
  - `EXECUTION_ROUTER_ADDRESS=0x...` (from deployment)
  - `MOCK_SWAP_ADAPTER_ADDRESS=0x...` (from deployment)
  - `ETH_TESTNET_RPC_URL=...` (Sepolia RPC URL)
  - `EXECUTION_MODE=eth_testnet`
- Restart backend after changing env vars
- Verify RPC URL works: `curl -X POST $ETH_TESTNET_RPC_URL -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`

### 4. Execution Prepare Fails
**Symptom**: `POST /api/execute/prepare` returns error

**Check**:
```bash
# Test preflight first:
curl http://localhost:3001/api/execute/preflight
# Should return: {"ok": true, "router": "0x...", "adapter": "0x..."}
```

**Fix**:
- Preflight must pass first (see #3)
- Check adapter is allowlisted:
  ```bash
  cast call $EXECUTION_ROUTER_ADDRESS \
    "isAdapterAllowed(address)(bool)" \
    $MOCK_SWAP_ADAPTER_ADDRESS \
    --rpc-url $ETH_TESTNET_RPC_URL
  # Should return: true
  ```
- If false, adapter wasn't allowlisted during deployment (check deployment script)

### 5. Transaction Fails on Sepolia
**Symptom**: Transaction sent but fails or reverts

**Check**:
```bash
# Check transaction on Etherscan:
# https://sepolia.etherscan.io/tx/0x...
# Look for "Status: Fail" or revert reason
```

**Fix**:
- Check user wallet has Sepolia ETH for gas
- Check user has approved tokens (if swap requires approval)
- Check adapter is allowlisted (see #4)
- Check plan deadline hasn't expired
- Check nonce is correct (replay protection)

### 6. Session Mode Relayer Fails
**Symptom**: Session mode execution fails with relayer error

**Check**:
```bash
# Check relayer env vars:
echo $EXECUTION_AUTH_MODE    # Should be "session"
echo $RELAYER_PRIVATE_KEY    # Should be set
```

**Fix**:
- Set `EXECUTION_AUTH_MODE=session` in `agent/.env`
- Set `RELAYER_PRIVATE_KEY=0x...` (wallet with Sepolia ETH for gas)
- Verify relayer wallet has ETH: `cast balance $RELAYER_ADDRESS --rpc-url $ETH_TESTNET_RPC_URL`
- Restart backend after changing env vars

### 7. E2E Smoke Test Fails
**Symptom**: `node agent/scripts/e2e-sepolia-smoke.ts` fails

**Check**:
```bash
# Required env vars:
echo $EXECUTION_MODE         # Should be "eth_testnet"
echo $TEST_USER_ADDRESS      # Should be set (0x...)
echo $EXECUTION_AUTH_MODE    # Should be "direct" or "session"
```

**Fix**:
- Set all required env vars (see script comments for full list)
- Ensure backend is running: `curl http://localhost:3001/health`
- Ensure contracts are deployed (see #1, #2)
- Ensure preflight passes (see #3)
- For session mode: Set `RELAYER_PRIVATE_KEY` (see #6)

---

## Quick Reference: Key Files

**Frontend Entry Points**:
- `src/main.tsx` - React app entry
- `src/components/Chat.tsx` - Main chat UI
- `src/lib/blossomApi.ts` - Backend API client
- `src/lib/mockParser.ts` - Mock parser (fallback)

**Backend Entry Points**:
- `agent/src/server/http.ts` - Express server
- `agent/src/services/llmClient.ts` - LLM integration
- `agent/src/utils/actionParser.ts` - Action validation
- `agent/src/executors/ethTestnetExecutor.ts` - Execution planning

**Contracts**:
- `contracts/scripts/deploy-sepolia.sh` - Deployment script
- `contracts/foundry.toml` - Foundry config

**Scripts**:
- `scripts/mvp-verify.sh` - MVP verification
- `scripts/endpoint-smoke-test.sh` - Endpoint smoke test
- `agent/scripts/e2e-sepolia-smoke.ts` - E2E smoke test

**Documentation**:
- `README.md` - Main README
- `docs/V1_MVP_REQUIREMENTS.md` - MVP requirements
- `docs/TESTNET_MVP_STATUS.md` - Deployment status
- `docs/SESSION_MODE_AUDIT.md` - Session mode docs

---

## Environment Variables Cheat Sheet

**Frontend** (`.env.local` at root):
```bash
VITE_USE_AGENT_BACKEND=true
VITE_AGENT_API_URL=http://localhost:3001
```

**Backend** (`agent/.env`):
```bash
# LLM
BLOSSOM_MODEL_PROVIDER=stub  # or openai/anthropic/gemini
BLOSSOM_OPENAI_API_KEY=...  # if using OpenAI
BLOSSOM_ANTHROPIC_API_KEY=...  # if using Anthropic
BLOSSOM_GEMINI_API_KEY=...  # if using Gemini

# Execution
EXECUTION_MODE=eth_testnet  # or sim
EXECUTION_AUTH_MODE=direct  # or session
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...

# Session Mode (if EXECUTION_AUTH_MODE=session)
RELAYER_PRIVATE_KEY=0x...
```

**Contracts** (deployment):
```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/...
DEPLOYER_PRIVATE_KEY=0x...
```

---

## Common Issues & Solutions

**Issue**: "Backend Offline" banner in UI
- **Solution**: Start backend: `cd agent && npm run dev:agent`

**Issue**: Chat doesn't respond
- **Solution**: Check browser console, verify `mockParser.ts` is working (mock mode) or backend is running (agent mode)

**Issue**: Execution fails with "Preflight check failed"
- **Solution**: Check `EXECUTION_MODE=eth_testnet`, contract addresses, RPC URL

**Issue**: Session mode doesn't work
- **Solution**: Set `EXECUTION_AUTH_MODE=session`, `RELAYER_PRIVATE_KEY`, restart backend

**Issue**: Contracts deployment fails
- **Solution**: Check `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, wallet has ETH for gas

**Issue**: TypeScript errors in `_suddengreencard`
- **Solution**: Ignore - it's excluded from build. Check `tsconfig.json` exclude.

---

## Next Steps

1. **Read full repo map**: `docs/REPO_MAP.md` (detailed folder-by-folder breakdown)
2. **Check canonical docs**: `docs/V1_MVP_REQUIREMENTS.md`, `docs/TESTNET_MVP_STATUS.md`
3. **Run verification**: `./scripts/mvp-verify.sh --start-backend`
4. **Explore codebase**: Start with `src/components/Chat.tsx` and `agent/src/server/http.ts`
