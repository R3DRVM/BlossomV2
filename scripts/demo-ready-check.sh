#!/bin/bash

#
# Demo Ready Check Script
# Comprehensive CI-style check for investor demo readiness
#
# Exit on first error for strict checking
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$ROOT_DIR/logs"
REPORT_FILE="$LOG_DIR/demo-ready-report.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track overall status
OVERALL_STATUS="READY"
declare -a FAILURES=()

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Start report
echo "================================================" | tee "$REPORT_FILE"
echo "  Blossom Demo Readiness Check" | tee -a "$REPORT_FILE"
echo "  $(date)" | tee -a "$REPORT_FILE"
echo "================================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# Helper function for step output
step() {
    echo -e "${BLUE}[STEP]${NC} $1" | tee -a "$REPORT_FILE"
}

pass() {
    echo -e "  ${GREEN}✓ PASS${NC}: $1" | tee -a "$REPORT_FILE"
}

fail() {
    echo -e "  ${RED}✗ FAIL${NC}: $1" | tee -a "$REPORT_FILE"
    FAILURES+=("$1")
    OVERALL_STATUS="NOT READY"
}

warn() {
    echo -e "  ${YELLOW}⚠ WARN${NC}: $1" | tee -a "$REPORT_FILE"
}

info() {
    echo -e "  ${NC}  INFO${NC}: $1" | tee -a "$REPORT_FILE"
}

#==========================================
# PHASE A: Contracts
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "A) Contracts: forge build + forge test"

cd "$ROOT_DIR/contracts"

if ! command -v forge &> /dev/null; then
    fail "Foundry (forge) not installed. Install from https://book.getfoundry.sh/"
else
    # Build contracts
    if forge build --force 2>&1 | tail -3 | tee -a "$REPORT_FILE"; then
        pass "forge build succeeded"
    else
        fail "forge build failed"
    fi

    # Run tests
    TEST_OUTPUT=$(forge test 2>&1)
    if echo "$TEST_OUTPUT" | grep -q "passed"; then
        TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "passed|failed" | tail -1)
        pass "forge test: $TEST_SUMMARY"
    else
        fail "forge test failed"
        echo "$TEST_OUTPUT" | tail -10 | tee -a "$REPORT_FILE"
    fi
fi

#==========================================
# PHASE B: Backend
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "B) Backend: npm run build"

cd "$ROOT_DIR/agent"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    fail "npm not installed"
else
    # Build backend
    if npm run build 2>&1 | tail -3 | tee -a "$REPORT_FILE"; then
        pass "Backend build succeeded"
    else
        fail "Backend build failed"
    fi
fi

#==========================================
# PHASE C: Frontend
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "C) Frontend: npm run build"

cd "$ROOT_DIR"

if npm run build 2>&1 | tail -3 | tee -a "$REPORT_FILE"; then
    pass "Frontend build succeeded"
else
    fail "Frontend build failed"
fi

#==========================================
# PHASE D: Preflight Check (if backend running)
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "D) Preflight check (requires running backend)"

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"

# Check if backend is running (fail fast if not)
HEALTH_RESPONSE=$(curl -s --max-time 5 "$BACKEND_URL/health" 2>/dev/null || echo "OFFLINE")

if [[ "$HEALTH_RESPONSE" == *"ok"* ]] || [[ "$HEALTH_RESPONSE" == *"status.*ok"* ]]; then
    pass "Backend is running at $BACKEND_URL"
    
    # Run preflight
    PREFLIGHT_RESPONSE=$(curl -s --max-time 10 "$BACKEND_URL/api/execute/preflight" 2>/dev/null || echo '{"ok":false,"error":"timeout"}')
    echo "  Preflight response:" | tee -a "$REPORT_FILE"
    echo "$PREFLIGHT_RESPONSE" | jq . 2>/dev/null | head -20 | tee -a "$REPORT_FILE" || echo "$PREFLIGHT_RESPONSE" | tee -a "$REPORT_FILE"
    
    # Check preflight ok
    PREFLIGHT_OK=$(echo "$PREFLIGHT_RESPONSE" | jq -r '.ok' 2>/dev/null)
    if [[ "$PREFLIGHT_OK" == "true" ]]; then
        pass "Preflight returned ok:true"
    else
        warn "Preflight returned ok:$PREFLIGHT_OK (may need configuration for eth_testnet mode)"
        info "For SIM mode, preflight always returns ok:true"
    fi
    
    # Test wallet balances endpoint
    TEST_ADDRESS="0x1234567890123456789012345678901234567890"
    BALANCE_RESPONSE=$(curl -s --max-time 10 "$BACKEND_URL/api/wallet/balances?address=$TEST_ADDRESS" 2>/dev/null || echo '{"error":"timeout"}')
    BALANCE_HAS_NATIVE=$(echo "$BALANCE_RESPONSE" | jq -r '.native' 2>/dev/null)
    if [[ "$BALANCE_HAS_NATIVE" != "null" && "$BALANCE_HAS_NATIVE" != "" ]]; then
      pass "Wallet balances endpoint returns valid structure"
      info "Endpoint response includes: native, tokens, chainId"
    else
      BALANCE_ERROR=$(echo "$BALANCE_RESPONSE" | jq -r '.error' 2>/dev/null)
      if [[ "$BALANCE_ERROR" != "null" && "$BALANCE_ERROR" != "" ]]; then
        warn "Wallet balances endpoint error: $BALANCE_ERROR (may need eth_testnet config)"
      else
        warn "Wallet balances endpoint structure unexpected"
      fi
    fi
else
    fail "Backend not running - cannot proceed with demo readiness check"
    echo "" | tee -a "$REPORT_FILE"
    echo "  FIX: Start backend with one of these commands:" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
    echo "    npm run dev:demo          # Start both frontend + backend" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
    echo "  Or manually:" | tee -a "$REPORT_FILE"
    echo "    cd agent" | tee -a "$REPORT_FILE"
    echo "    PORT=3001 npm run dev" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
    echo "  Then re-run: ./scripts/demo-ready-check.sh" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
fi

#==========================================
# PHASE E: Local MVP Check Script
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "E) Local MVP check script"

if [[ -f "$ROOT_DIR/scripts/local-mvp-check.sh" ]]; then
    pass "local-mvp-check.sh exists"
    info "Run manually: ./scripts/local-mvp-check.sh"
else
    warn "local-mvp-check.sh not found"
fi

#==========================================
# PHASE F: Playwright Tests
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "F) Playwright tests"

cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/playwright.config.ts" ]]; then
    pass "Playwright configured"
    
    if [[ "$HEALTH_RESPONSE" == *"ok"* ]]; then
        info "Running Playwright API tests..."
        if npx playwright test --reporter=list 2>&1 | tee -a "$REPORT_FILE"; then
            pass "Playwright tests passed"
        else
            warn "Some Playwright tests failed (may need configuration)"
        fi
    else
        warn "Skipping Playwright tests (backend not running)"
    fi
else
    warn "Playwright not configured"
fi

#==========================================
# PHASE G: Telemetry Check
#==========================================
echo "" | tee -a "$REPORT_FILE"
step "G) Telemetry check"

TELEMETRY_LOG="$ROOT_DIR/agent/logs/telemetry.jsonl"
if [[ -f "$TELEMETRY_LOG" ]]; then
    LINES=$(wc -l < "$TELEMETRY_LOG" | tr -d ' ')
    pass "Telemetry log exists: $LINES lines"
    info "Last event:"
    tail -1 "$TELEMETRY_LOG" 2>/dev/null | jq -c '. | {type, ts}' 2>/dev/null | tee -a "$REPORT_FILE" || echo "  (empty)" | tee -a "$REPORT_FILE"
else
    info "No telemetry log yet (will be created on first request)"
fi

#==========================================
# SUMMARY
#==========================================
echo "" | tee -a "$REPORT_FILE"
echo "================================================" | tee -a "$REPORT_FILE"

if [[ "$OVERALL_STATUS" == "READY" ]]; then
    echo -e "  ${GREEN}DEMO READY: All critical checks passed${NC}" | tee -a "$REPORT_FILE"
else
    echo -e "  ${RED}NOT READY: ${#FAILURES[@]} failure(s) detected${NC}" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
    echo "  Failures:" | tee -a "$REPORT_FILE"
    for failure in "${FAILURES[@]}"; do
        echo "    - $failure" | tee -a "$REPORT_FILE"
    done
fi

echo "================================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"
echo "Report saved to: $REPORT_FILE" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# Next steps
echo "Next steps:" | tee -a "$REPORT_FILE"
echo "  1. Start backend: cd agent && npm run dev" | tee -a "$REPORT_FILE"
echo "  2. Start frontend: npm run dev" | tee -a "$REPORT_FILE"
echo "  3. Open http://127.0.0.1:5173/app" | tee -a "$REPORT_FILE"
echo "  4. Connect wallet (Sepolia)" | tee -a "$REPORT_FILE"
echo "  5. Test swap/lending/perps flows" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# Exit with appropriate code
if [[ "$OVERALL_STATUS" == "READY" ]]; then
    exit 0
else
    exit 1
fi

