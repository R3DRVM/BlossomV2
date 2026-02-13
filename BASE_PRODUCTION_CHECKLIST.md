# Base Sepolia Production Deployment Checklist

## Required Environment Variables

### Settlement Chain
```bash
DEFAULT_SETTLEMENT_CHAIN=base_sepolia
```

### Base Sepolia RPC
```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_FALLBACK_URLS=https://base-sepolia.blockpi.network/v1/rpc/public
```

### Contract Addresses (from deploy:settlement:base output)
```bash
EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA=0x...
BUSDC_ADDRESS_BASE_SEPOLIA=0x...
DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA=0x...
DEMO_EVENT_ADAPTER_ADDRESS_BASE_SEPOLIA=0x...
DEMO_WETH_ADDRESS_BASE_SEPOLIA=0x...
ROUTER_ADDRESS_BASE_SEPOLIA=0x...
```

### Relayer & Funding
```bash
RELAYER_PRIVATE_KEY_BASE_SEPOLIA=0x...
RELAYER_TOPUP_ENABLED=true
FUNDING_WALLET_PRIVATE_KEY_BASE_SEPOLIA=0x...
MIN_RELAYER_ETH_BASE_SEPOLIA=0.01
TARGET_RELAYER_ETH_BASE_SEPOLIA=0.05
MAX_TOPUPS_PER_HOUR=10
MAX_TOPUP_ETH_PER_DAY=0.5
```

### Cross-Chain Routing
```bash
CROSS_CHAIN_CREDIT_ROUTING_ENABLED=true
CROSS_CHAIN_CREDIT_MAX_USD_PER_TX=500
```

## Verification Commands

### 1. Deploy Contracts
```bash
npm run deploy:settlement:base
```

### 2. Health Check
```bash
curl https://api.blossom.onl/api/health | jq '.baseSepolia'
```

**Expected Output:**
```json
{
  "ready": true,
  "hasRouter": true,
  "hasBusdc": true,
  "hasPerpAdapter": true,
  "hasRpc": true,
  "hasRelayerKey": true,
  "missing": [],
  "settlementChain": "base_sepolia",
  "defaultSettlementChain": "base_sepolia"
}
```

**If missing[] is not empty:**
- The missing array lists the exact environment variables that need to be set
- Set each missing variable and restart the service
- Re-run health check until missing[] is empty

### 3. Relayer Status
```bash
curl "https://api.blossom.onl/api/relayer/status?chain=base_sepolia" \
  -H "X-Ledger-Secret: $DEV_LEDGER_SECRET" | jq .
```

**Expected Output:**
```json
{
  "ok": true,
  "relayer": {
    "balanceEth": "0.05",
    "minEth": "0.01",
    "okToExecute": true
  },
  "funding": {
    "fundingBalanceEth": "0.10"
  }
}
```

### 4. Smoke Test
```bash
npm run base:smoke:prod
```

**Expected Output:**
- All checks pass (healthEndpoint, relayerStatus, chainId, bytecode verification, happy path test)
- Artifact written to `logs/base-smoke-prod.json` with `ok: true`
- Two transaction hashes with confirmed receipts on Base Sepolia

**Smoke Test Checks:**
1. **Health Endpoint**: Service is up and Base Sepolia lane is ready
2. **Relayer Status**: Relayer has sufficient balance (>= 0.01 ETH)
3. **Chain ID**: RPC is actually Base Sepolia (84532), not Sepolia (11155111)
4. **Bytecode Verification**: All contracts deployed with non-zero bytecode
5. **Happy Path Test**: One deterministic execution with confirmed Base Sepolia receipts

**If smoke test fails:**
- Check `logs/base-smoke-prod.json` for detailed error messages
- Common issues:
  - Missing env vars → See `baseSepolia.missing` from health check
  - Wrong RPC URL → Verify BASE_SEPOLIA_RPC_URL points to Base, not Sepolia
  - Insufficient relayer balance → Fund relayer wallet
  - Contract not deployed → Run `npm run deploy:settlement:base`

### 5. Proof Gate
```bash
npm run mvp:prove:prod
```

**Expected Output:**
- Artifact written to `logs/mvp-prove-report.json` with `ok: true`
- At least 10 confirmed cross-chain proofs targeting Base Sepolia
- Zero base fallback violations
- Zero proof-only violations

**Proof Gate Checks:**
1. **Process Exit Zero**: Stress test completed without errors
2. **Minimum Proofs**: At least 10 valid proofs collected
3. **Minimum Cross-Chain Proofs**: At least 10 cross-chain credit proofs
4. **No Proof-Only**: No executions blocked by proof-only mode
5. **No Base Fallback**: All proofs targeted Base Sepolia (no Sepolia fallback)
6. **Output Produced**: Stress test output file exists

**If proof gate fails:**
- Check `logs/mvp-prove-report.json` for failure reasons
- Common issues:
  - `noBaseFallback: false` → System is falling back to Sepolia instead of Base
    - Verify DEFAULT_SETTLEMENT_CHAIN=base_sepolia
    - Check /api/health to see if Base lane is ready
  - `minimumProofs: false` → Not enough successful executions
    - Check relayer balance (needs >= 0.01 ETH)
    - Verify contracts are deployed correctly
  - `noProofOnly: true` → Proof-only violations detected
    - Check if CROSS_CHAIN_CREDIT_ROUTING_ENABLED=true

## Success Criteria

Before declaring the Base Sepolia beta launch ready:

- [ ] Health endpoint shows `baseSepolia.ready: true`
- [ ] Health endpoint shows `baseSepolia.missing: []` (empty array)
- [ ] Relayer balance >= 0.01 ETH
- [ ] Funding wallet balance >= 0.05 ETH
- [ ] `base:smoke:prod` passes (ok: true)
- [ ] `mvp:prove:prod` passes with >= 10 Base proofs
- [ ] No base fallback violations in proof gate
- [ ] All bytecode verification checks pass

## Explorer Links

- **Base Sepolia Explorer**: https://sepolia.basescan.org
- **Transaction**: https://sepolia.basescan.org/tx/{txHash}
- **Address**: https://sepolia.basescan.org/address/{address}

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Base Sepolia Beta                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User (Solana)                                              │
│       │                                                     │
│       ├─► Blossom Agent API (/api/ledger/intents/execute) │
│       │                                                     │
│       └─► Cross-Chain Credit Router                        │
│                 │                                           │
│                 ├─► Mint Credit (Base Sepolia)             │
│                 │   - TX: creditTxHash                     │
│                 │   - Receipt: confirmed                   │
│                 │                                           │
│                 └─► Execute Action (Base Sepolia)          │
│                     - TX: executionTxHash                  │
│                     - Receipt: confirmed                   │
│                     - Relayed by: RELAYER_PRIVATE_KEY      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Properties:**
- **Default Settlement**: Base Sepolia (not Sepolia)
- **Fallback Behavior**: FAIL-CLOSED (no silent fallback to Sepolia in base-required modes)
- **Gas Funding**: Self-sustaining with synchronous top-up before execution
- **Proof Collection**: Minimum 10 confirmed Base Sepolia proofs required for beta gate
- **Error Handling**: BASE_REQUIRED_VIOLATION (409) if base required but fallback attempted

## Troubleshooting

### Issue: baseSepolia.ready = false

**Diagnosis:**
```bash
curl https://api.blossom.onl/api/health | jq '.baseSepolia.missing'
```

**Solution:**
- Set each missing environment variable listed in the `missing[]` array
- Restart the agent service
- Re-run health check to verify

### Issue: Smoke test fails with "Chain ID mismatch"

**Diagnosis:**
- BASE_SEPOLIA_RPC_URL is pointing to wrong network

**Solution:**
```bash
# Verify RPC URL returns Base Sepolia chain ID (84532)
curl -X POST $BASE_SEPOLIA_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | jq '.result'

# Expected: "0x14a34" (84532 in hex)
```

### Issue: Smoke test fails with "Missing or invalid creditTxHash"

**Diagnosis:**
- Cross-chain routing is not enabled or failing
- Relayer has insufficient balance

**Solution:**
1. Verify CROSS_CHAIN_CREDIT_ROUTING_ENABLED=true
2. Check relayer balance: `npm run base:smoke:prod` (step 2)
3. Fund relayer if balance < 0.01 ETH
4. Retry smoke test

### Issue: Proof gate shows noBaseFallback: false

**Diagnosis:**
- System is falling back to Sepolia despite base-required mode

**Solution:**
1. Verify DEFAULT_SETTLEMENT_CHAIN=base_sepolia
2. Check /api/health baseSepolia.ready flag
3. Ensure all Base Sepolia contract addresses are set
4. Check relayer balance on Base Sepolia
5. Re-run mvp:prove:prod after fixes

### Issue: BASE_REQUIRED_VIOLATION error in production

**Diagnosis:**
- Request required Base Sepolia settlement but system couldn't fulfill it

**Error Response Example:**
```json
{
  "ok": false,
  "code": "BASE_REQUIRED_VIOLATION",
  "message": "Base Sepolia required but relayer gas insufficient",
  "attemptedChain": "base_sepolia",
  "fallbackChain": null,
  "reason": "Relayer balance below minimum after top-up",
  "notes": [
    "Current: 0.005 ETH",
    "Minimum: 0.01 ETH",
    "Request metadata required Base settlement",
    "Fund relayer wallet or increase funding wallet balance"
  ]
}
```

**Solution:**
- Follow the actionable notes in the error response
- Most commonly: fund the relayer wallet on Base Sepolia
- Verify RELAYER_TOPUP_ENABLED=true for automatic top-ups

## Post-Deployment Monitoring

### Key Metrics to Monitor

1. **Relayer Balance** (every 1 hour)
   ```bash
   curl "https://api.blossom.onl/api/relayer/status?chain=base_sepolia" \
     -H "X-Ledger-Secret: $DEV_LEDGER_SECRET" | jq '.relayer.balanceEth'
   ```

2. **Health Status** (every 5 minutes)
   ```bash
   curl https://api.blossom.onl/api/health | jq '.baseSepolia.ready'
   ```

3. **Error Rate** (check application logs)
   - Look for BASE_REQUIRED_VIOLATION errors
   - Look for BLOCKED_NEEDS_GAS errors
   - Both indicate potential relayer funding issues

### Alert Thresholds

- **CRITICAL**: baseSepolia.ready = false
  - Action: Check missing[] array and set env vars

- **WARNING**: Relayer balance < 0.02 ETH (2x minimum)
  - Action: Fund relayer wallet within 1 hour

- **INFO**: Relayer balance < 0.03 ETH (3x minimum)
  - Action: Schedule funding within 24 hours

- **ERROR**: BASE_REQUIRED_VIOLATION rate > 1% of requests
  - Action: Investigate relayer funding or configuration

## Notes

- **Gas Drip Features**: NOT included in beta scope (will be added post-beta)
- **Sepolia Fallback**: Sepolia contracts remain deployed but are NOT used as fallback in base-required modes
- **Multi-Chain Support**: Both Base Sepolia and Sepolia lanes can coexist, but Base is primary
- **Synchronous Top-Up**: Automatically attempts relayer top-up before returning BLOCKED_NEEDS_GAS (5s timeout)
