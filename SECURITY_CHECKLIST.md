# Blossom Security Checklist

This document tracks security hardening tasks and verifications for MVP deployment.

## Pre-Deployment Security Requirements

### ✅ Completed

- [x] Rate limiting on `/api/mint` endpoint (5 requests/min per wallet)
- [x] Rate limiting on `/api/execute` endpoint (10 requests/min per wallet)
- [x] Rate limiting on `/api/session` endpoints (10 requests/min per wallet)
- [x] CORS allowlist configured (localhost, blossom.onl subdomains)
- [x] Input validation on critical endpoints (ExecutePrepare, ExecuteRelayed, ExecuteSubmit)
- [x] XSS protection via React auto-escaping and angle bracket normalization
- [x] Custom auth headers with signature verification (x-auth-chain, x-auth-address, x-auth-signature)
- [x] Mint limits persisted to SQLite (survives server restarts)
- [x] Sentry integration for error tracking
- [x] Security headers in Vercel deployment (X-XSS-Protection, X-Frame-Options, etc.)

### ⏳ Pending

- [ ] Slither static analysis on contracts
- [ ] Security audit by third party (recommended for production)
- [ ] Testnet exploit simulation and response procedures

## Static Analysis

### Running Slither

Slither is a static analysis tool for Solidity contracts. To install and run:

```bash
# Install Slither (requires Python 3.8+)
pip install slither-analyzer

# Run analysis on all contracts
cd contracts
slither . --json slither-report.json

# Or run specific checks
slither . --include-paths contracts/ --solc-remaps @openzeppelin=node_modules/@openzeppelin
```

Expected results:
- HIGH severity: Fix before deployment
- MEDIUM severity: Document and assess impact
- LOW severity: Consider fixing, acceptable for MVP

### Solidity Version

All contracts use:
- Solidity ^0.8.20
- OpenZeppelin ^5.0.0 (includes reentrancy guards)

## Contract Security Measures

### Implemented

1. **Reentrancy Protection**
   - OpenZeppelin ReentrancyGuard used in:
     - DemoLendingVault.sol (lend/withdraw)
     - DemoPerpEngine.sol (open/close positions)
     - DemoEventEngine.sol (buy/sell events)

2. **Access Control**
   - Adapter pattern enforces execution through ExecutionRouter
   - Only whitelisted adapters can mint demo tokens
   - Session enforcement prevents unauthorized calls

3. **Input Validation**
   - Amount checks (> 0, <= balance)
   - Token address validation
   - Slippage protection (for swaps)

4. **Safe Math**
   - Solidity 0.8+ includes overflow/underflow checks
   - No unchecked blocks used in critical logic

### Recommended Before Production

1. **Third-party Audit**
   - Recommended: Trail of Bits, OpenZeppelin, or similar
   - Expected cost: $10k-50k for protocol-level audit
   - Timeline: 2-4 weeks

2. **Enhanced Monitoring**
   - Monitor contract balance changes
   - Alert on unusual activity patterns
   - Rate limit minting per 24h period (already implemented)

3. **Upgrade Path**
   - Consider UUPS proxy pattern for upgradeable contracts
   - Currently: Immutable for security simplicity

## API Security

### Rate Limiting Status

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| POST /api/execute | 10 | 1 min | wallet |
| POST /api/session | 10 | 1 min | wallet |
| POST /api/mint | 5 | 1 min | wallet |
| POST /api/prepare | - | - | No limit yet |
| GET /api/stats | - | - | No limit |

**Recommendation**: Add rate limiting to all POST endpoints for defense-in-depth.

### CORS Configuration

```javascript
ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://blossom.onl',
  'https://www.blossom.onl',
  /^https:\/\/.*\.blossom\.onl$/,  // All subdomains
]
```

**Status**: ✅ Properly configured. Public RPC access is restricted to allowlisted domains.

### Authentication

**Current**: Custom message signing
- Uses EVM personal_sign + Solana signMessage
- Headers: x-auth-chain, x-auth-address, x-auth-signature
- Nonce-based replay protection: Not yet implemented

**Recommended upgrade**: Full SIWE (Sign-In with Ethereum) compliance
- Adds timestamp, expiry, domain binding
- Standardized across web3 ecosystem
- Prevents replay attacks across domains

## Known Risks & Mitigations

### 1. In-Memory Replay Attack Vector ⚠️

**Risk**: If session auth is disabled, repeated requests with same signature could be replayed.

**Mitigation**:
- ✅ Mint limiter enforces daily cap per address
- ✅ Session mode uses one-time codes (session.sessionId)
- Recommendation: Add nonce tracking to prevent exact request replays

**Action**: Document in SECURITY.md, acceptable for testnet MVP

### 2. Solana Program Not Deployed 🔴

**Risk**: Solana execute endpoints show as "Coming Soon" but don't execute.

**Mitigation**:
- ✅ Frontend warns users that Solana is "Proof-Only"
- ✅ intentRunner marks Solana as proof_only (records intent, no on-chain action)
- Recommendation: Implement and deploy Solana execution before mainnet

**Action**: Deferred to Phase 2

### 3. Demo Token Mint Without KYC 🟡

**Risk**: Unlimited wallets can mint $1000/day of demo bUSDC.

**Mitigation**:
- ✅ Daily cap enforced ($1000)
- ✅ Rate limited (5 requests/min per wallet)
- ✅ Testnet only (not real value)
- Recommendation: Add IP-based additional limits if abuse detected

**Acceptable for MVP**: Yes, testnet scenario

## Deployment Checklist

Before deploying to production, verify:

### Pre-Deployment (Day 1)

- [ ] Run `forge test` - all tests passing
- [ ] Run `npm run test:e2e` - all API tests passing
- [ ] Load test: 100+ concurrent users
  ```bash
  # Example with k6 (optional)
  k6 run tests/load.js
  ```
- [ ] Verify Sentry is receiving error events
- [ ] Check Fly.io agent health endpoint: `curl https://[app].fly.dev/api/health`

### Pre-Deployment (Day 2)

- [ ] Manual security testing:
  - [ ] Test rate limiting manually
  - [ ] Verify CORS blocks unauthorized origins
  - [ ] Test mint limit with multiple wallets
  - [ ] Confirm session enforcement works
- [ ] Run Slither (or get audit results)
- [ ] Review contract deployment addresses in DEPLOY_OUTPUT.env

### Post-Deployment Monitoring

- [ ] Monitor Sentry error rate (< 1%)
- [ ] Check telemetry dashboard for stats collection
- [ ] Monitor contract balance changes
- [ ] Set up alerts for suspicious activity

## Security Contacts

In case of security issues:

1. **Immediate**: Report to [security contact email - TBD]
2. **Public disclosure**: After fix is deployed and verified
3. **Timeline**: 7-day responsible disclosure window for MVP

## References

- [SECURITY.md](./SECURITY.md) - Initial security analysis
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design overview
- [Foundry Security Best Practices](https://book.getfoundry.sh/)
- [OWASP Top 10 for Smart Contracts](https://owasp.org/www-community/attacks/Smart_contract_bugs)
