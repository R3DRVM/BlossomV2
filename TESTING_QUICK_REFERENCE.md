# Testing Quick Reference

**Full Guide**: See `MANUAL_TESTING_CHECKLIST.md` for detailed steps.

## Quick Commands

### Automated Verification (Recommended First Step)
```bash
# Run all automated checks (contracts, builds, endpoints, testnet readiness)
# Note: Backend must be running separately, or use --start-backend flag
./scripts/mvp-verify.sh

# Auto-start backend if not running (recommended for first-time users)
./scripts/mvp-verify.sh --start-backend

# With testnet checks (requires EXECUTION_MODE=eth_testnet)
EXECUTION_MODE=eth_testnet ./scripts/mvp-verify.sh --start-backend

# With portfolio test (requires TEST_USER_ADDRESS)
EXECUTION_MODE=eth_testnet TEST_USER_ADDRESS=0x... ./scripts/mvp-verify.sh --start-backend
```

**Quickstart (Mac):**

1. **Install dependencies:**
   ```bash
   npm run install:all
   ```

2. **Start backend (in one terminal):**
   ```bash
   cd agent && PORT=3001 npm run dev
   ```

3. **Run verifier (in another terminal):**
   ```bash
   ./scripts/mvp-verify.sh
   ```
   
   Or use auto-start (starts backend automatically):
   ```bash
   ./scripts/mvp-verify.sh --start-backend
   ```

4. **Expected success output:**
   ```
   ✔ All automated checks PASSED
   
   You can now proceed with the manual UI testing steps listed above.
   ```

5. **Run E2E Sepolia smoke test (optional, for testnet validation):**
   ```bash
   # Set required env vars
   export EXECUTION_MODE=eth_testnet
   export TEST_USER_ADDRESS=0xYOUR_ADDRESS
   export EXECUTION_AUTH_MODE=direct
   
   # Run test
   node agent/scripts/e2e-sepolia-smoke.ts
   ```

**If backend is not running:**
The verifier will show:
```
✗ FAIL Backend not running

The backend is not responding at http://localhost:3001/health

To start the backend manually, run:
  cd agent && PORT=3001 npm run dev

Or use the verification script with auto-start:
  ./scripts/mvp-verify.sh --start-backend
```

### Start Services
```bash
# Backend
cd agent && npm run dev

# Frontend (separate terminal)
npm run dev
```

### Run Smoke Test
```bash
# Make sure backend is running first
./scripts/endpoint-smoke-test.sh http://localhost:3001
```

If backend is not running, the script will:
- Show clear error message
- Print exact command to start backend
- Exit with non-zero code

### Preflight Check
```bash
curl http://localhost:3001/api/execute/preflight | jq
```

### Deploy Contracts
```bash
export SEPOLIA_RPC_URL="..."
export DEPLOYER_PRIVATE_KEY="0x..."
export SEPOLIA_UNISWAP_V3_ROUTER="0x..."
cd contracts && ./scripts/deploy-sepolia.sh
```

## Environment Variables Checklist

### For Automated Verification (`mvp-verify.sh`)
- [ ] `EXECUTION_MODE=eth_testnet` (optional, enables testnet checks)
- [ ] `TEST_USER_ADDRESS=0x...` (optional, tests portfolio endpoint)
- [ ] `PORT=3001` (optional, backend port, default: 3001)
- [ ] `EXECUTION_AUTH_MODE=direct` or `session` (optional, default: direct)

### For E2E Sepolia Smoke Test (`e2e-sepolia-smoke.ts`)
- [ ] `EXECUTION_MODE=eth_testnet` (required)
- [ ] `TEST_USER_ADDRESS=0x...` (required, Ethereum address for testing)
- [ ] `EXECUTION_AUTH_MODE=direct` or `session` (optional, default: direct)
- [ ] `BASE_URL=http://localhost:3001` (optional, default: http://localhost:3001)
- [ ] `RELAYER_PRIVATE_KEY=0x...` (required only if using `--actually-relay` in session mode)

### Backend (`agent/.env`)
- [ ] `EXECUTION_MODE=eth_testnet`
- [ ] `ETH_TESTNET_RPC_URL=...`
- [ ] `EXECUTION_ROUTER_ADDRESS=...` (from deploy)
- [ ] `MOCK_SWAP_ADAPTER_ADDRESS=...` (from deploy)
- [ ] `UNISWAP_V3_ADAPTER_ADDRESS=...` (from deploy)
- [ ] `USDC_ADDRESS_SEPOLIA=...`
- [ ] `WETH_ADDRESS_SEPOLIA=...`
- [ ] `EXECUTION_AUTH_MODE=direct` (or `session`)
- [ ] `RELAYER_PRIVATE_KEY=0x...` (if session mode)

### Frontend (`frontend/.env.local`)
- [ ] `VITE_EXECUTION_MODE=eth_testnet`
- [ ] `VITE_EXECUTION_AUTH_MODE=direct` (or `session`)
- [ ] `VITE_ETH_TESTNET_INTENT=swap_usdc_weth` (or `swap_weth_usdc`)

## Test Phases

1. **Phase 1**: Backend sanity (no chain) → Smoke test passes
2. **Phase 2**: Deploy + preflight → `ok: true`
3. **Phase 3**: Direct mode swap → Wallet prompts, tx succeeds
4. **Phase 4**: Session mode → Zero prompts after setup
5. **Phase 5**: Negative tests → Graceful failures

## Common Issues

| Issue | Solution |
|-------|----------|
| Preflight `ok: false` | Check `notes[]` array, verify env vars |
| Portfolio doesn't sync | Check RPC URL, verify token addresses |
| Swap fails | Check token balances, verify addresses |
| Session mode prompts | Check `localStorage` for `sessionId` |
| Smoke test fails | Check backend is running, verify port |

## Verification Checklist

- [ ] All smoke tests pass (green/yellow, no red)
- [ ] Preflight returns `ok: true`
- [ ] Portfolio syncs real balances
- [ ] Direct mode swap executes successfully
- [ ] Session mode has zero prompts after setup
- [ ] Insufficient balance handled gracefully
- [ ] Auto-approve works when allowance revoked

## MVP Verified When

✅ Real on-chain swaps execute from chat  
✅ Direct and session modes both work  
✅ Real balances shown in UI  
✅ Security constraints enforced (nonces, deadlines, caps)

---

**See `MANUAL_TESTING_CHECKLIST.md` for full details.**

