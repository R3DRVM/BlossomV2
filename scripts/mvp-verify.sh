#!/bin/bash
#
# Blossom Sepolia MVP Verification Script
# Automated checks that can be validated from CLI/server
# Returns PASS/FAIL report and lists remaining manual steps
#
# Usage:
#   ./scripts/mvp-verify.sh [--start-backend]
#
# Options:
#   --start-backend    Automatically start backend if not running
#
# Environment Variables:
#   EXECUTION_MODE - If set to 'eth_testnet', testnet checks are required
#   TEST_USER_ADDRESS - Optional: Ethereum address for portfolio endpoint test
#   PORT - Backend port (default: 3001)
#
# Exit Codes:
#   0 - All automated checks pass
#   1 - One or more automated checks fail

# Use set -euo pipefail only where safe (avoid issues with pipefail in zsh)
set -eu

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_PID=""
AUTO_START_BACKEND=false

# Parse command line arguments
while [ $# -gt 0 ]; do
  case $1 in
    --start-backend)
      AUTO_START_BACKEND=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--start-backend]"
      exit 1
      ;;
  esac
done

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Track failed steps
FAILED_STEPS=()

# Cleanup function
cleanup() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo -e "\n${YELLOW}Cleaning up backend process (PID: $BACKEND_PID)...${NC}"
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# Helper: Print step header
print_step() {
  local step=$1
  local title=$2
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Step $step: $title${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Helper: Print success
print_pass() {
  echo -e "${GREEN}✓ PASS${NC} $1"
  PASSED=$((PASSED + 1))
}

# Helper: Print failure
print_fail() {
  echo -e "${RED}✗ FAIL${NC} $1"
  FAILED=$((FAILED + 1))
  FAILED_STEPS+=("$1")
}

# Helper: Print skip
print_skip() {
  echo -e "${YELLOW}⏭  SKIP${NC} $1"
  SKIPPED=$((SKIPPED + 1))
}

# Helper: Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Helper: Mask sensitive values in output
mask_secret() {
  local value=$1
  if [ ${#value} -gt 8 ]; then
    echo "${value:0:4}...${value: -4}"
  else
    echo "***"
  fi
}

# Helper: Wait for backend to be ready
wait_for_backend() {
  local max_attempts=30
  local attempt=1
  
  echo "Waiting for backend to be ready..."
  
  while [ $attempt -le $max_attempts ]; do
    if curl -s -f "${BACKEND_URL}/health" >/dev/null 2>&1; then
      echo "Backend is ready!"
      return 0
    fi
    
    if [ $attempt -eq 1 ]; then
      echo -n "Polling"
    else
      echo -n "."
    fi
    
    sleep 1
    attempt=$((attempt + 1))
  done
  
  echo ""
  return 1
}

# Helper: Check if backend is already running
is_backend_running() {
  curl -s -f "${BACKEND_URL}/health" >/dev/null 2>&1
}

# Main script
main() {
  echo -e "${BLUE}"
  echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
  echo "║                    Blossom Sepolia MVP Verification                            ║"
  echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  
  cd "$REPO_ROOT"
  
  # Step A: Repo sanity (contract tests)
  print_step "A" "Repo Sanity - Contract Tests"
  
  if [ ! -d "contracts" ]; then
    print_fail "contracts/ directory not found"
  elif ! command_exists forge; then
    print_skip "forge not found (Foundry not installed)"
  else
    echo "Running: cd contracts && forge test"
    if (cd contracts && forge test >/dev/null 2>&1); then
      print_pass "Contract tests"
    else
      # Re-run to show output on failure
      (cd contracts && forge test 2>&1) || true
      print_fail "Contract tests failed"
    fi
  fi
  
  # Step B: Build sanity
  print_step "B" "Build Sanity"
  
  # Check if agent directory exists
  if [ -d "agent" ]; then
    echo "Building backend..."
    if (cd agent && npm run build >/dev/null 2>&1); then
      print_pass "Backend build"
    else
      # Re-run to show output on failure
      (cd agent && npm run build 2>&1) || true
      print_fail "Backend build failed"
    fi
  else
    print_skip "agent/ directory not found"
  fi
  
  # Build frontend
  echo "Building frontend..."
  if npm run build >/dev/null 2>&1; then
    print_pass "Frontend build"
  else
    # Re-run to show output on failure
    npm run build 2>&1 | tail -20 || true
    print_fail "Frontend build failed"
  fi
  
  # Step C: Backend endpoint sanity
  print_step "C" "Backend Endpoint Sanity"
  
  # Check if backend is already running
  if is_backend_running; then
    echo "Backend is already running on port ${BACKEND_PORT}"
    print_pass "Backend is running"
  else
    if [ "$AUTO_START_BACKEND" = "true" ]; then
      echo "Auto-starting backend in background (--start-backend flag provided)..."
      
      if [ ! -d "agent" ]; then
        print_fail "agent/ directory not found"
      else
        cd agent
        
        # Start backend in background
        npm run dev > /tmp/blossom-backend.log 2>&1 &
        BACKEND_PID=$!
        cd ..
        
        echo "Backend started (PID: $BACKEND_PID)"
        echo "Logs: /tmp/blossom-backend.log"
        
        # Wait for backend to be ready
        if ! wait_for_backend; then
          print_fail "Backend failed to start or become ready"
          echo "Backend logs:"
          tail -20 /tmp/blossom-backend.log || true
        else
          print_pass "Backend started and ready"
        fi
      fi
    else
      print_fail "Backend not running"
      echo ""
      echo "The backend is not responding at ${BACKEND_URL}/health"
      echo ""
      echo "To start the backend manually, run:"
      echo "  cd agent && PORT=${BACKEND_PORT} npm run dev"
      echo ""
      echo "Or use the verification script with auto-start:"
      echo "  ./scripts/mvp-verify.sh --start-backend"
      echo ""
    fi
  fi
  
  # Run smoke test (only if backend is running)
  if is_backend_running || [ -n "$BACKEND_PID" ]; then
    if [ -f "${SCRIPT_DIR}/endpoint-smoke-test.sh" ]; then
      echo ""
      echo "Running endpoint smoke test..."
      # Export EXECUTION_MODE and EXECUTION_AUTH_MODE for the smoke test
      export EXECUTION_MODE
      export EXECUTION_AUTH_MODE="${EXECUTION_AUTH_MODE:-direct}"
      if "${SCRIPT_DIR}/endpoint-smoke-test.sh" "${BACKEND_URL}"; then
        print_pass "Endpoint smoke test"
      else
        print_fail "Endpoint smoke test failed"
      fi
    else
      print_fail "endpoint-smoke-test.sh not found"
    fi
  else
    print_skip "Endpoint smoke test (backend not running)"
  fi
  
  # Step D: Testnet readiness checks
  print_step "D" "Testnet Readiness Checks"
  
  EXECUTION_MODE="${EXECUTION_MODE:-}"
  
  if [ "$EXECUTION_MODE" != "eth_testnet" ]; then
    print_skip "Testnet checks (EXECUTION_MODE not set to 'eth_testnet')"
    echo "  Set EXECUTION_MODE=eth_testnet to enable testnet checks"
  else
    echo "EXECUTION_MODE is set to 'eth_testnet' - running testnet checks..."
    
    # Check required env vars
    REQUIRED_VARS=(
      "ETH_TESTNET_RPC_URL"
      "EXECUTION_ROUTER_ADDRESS"
      "MOCK_SWAP_ADAPTER_ADDRESS"
      "USDC_ADDRESS_SEPOLIA"
      "WETH_ADDRESS_SEPOLIA"
    )
    
    MISSING_VARS=()
    for var in "${REQUIRED_VARS[@]}"; do
      if [ -z "${!var:-}" ]; then
        MISSING_VARS+=("$var")
      fi
    done
    
    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
      print_fail "Missing required environment variables:"
      for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
      done
    elif ! is_backend_running && [ -z "$BACKEND_PID" ]; then
      print_skip "Testnet readiness checks (backend not running)"
      echo "  Start backend first, then re-run verification"
    else
      echo "All required environment variables are set"
      
      # Test preflight endpoint
      echo "Calling /api/execute/preflight..."
      PREFLIGHT_RESPONSE=$(curl -s "${BACKEND_URL}/api/execute/preflight" || echo "")
      
      if [ -z "$PREFLIGHT_RESPONSE" ]; then
        print_fail "Preflight endpoint returned empty response"
      else
        # Check if ok: true (simple grep, assumes JSON)
        if echo "$PREFLIGHT_RESPONSE" | grep -q '"ok"\s*:\s*true'; then
          print_pass "Preflight check (ok: true)"
          
          # Extract and display key info (safely)
          if command_exists jq; then
            echo "Preflight details:"
            echo "$PREFLIGHT_RESPONSE" | jq -r '
              "  Mode: \(.mode // "unknown")",
              "  Router: \(.router // "not set")",
              "  Adapter: \(.adapter // "not set")",
              "  RPC: \(.rpc // false)",
              "  Notes: \(.notes | if length > 0 then join(", ") else "none" end)"
            ' 2>/dev/null || echo "  (Unable to parse JSON)"
          fi
        else
          print_fail "Preflight check (ok: false)"
          echo "Response:"
          if command_exists jq; then
            echo "$PREFLIGHT_RESPONSE" | jq '.' 2>/dev/null || echo "$PREFLIGHT_RESPONSE"
          else
            echo "$PREFLIGHT_RESPONSE"
          fi
        fi
      fi
      
      # Test portfolio endpoint if TEST_USER_ADDRESS is provided
      TEST_USER_ADDRESS="${TEST_USER_ADDRESS:-}"
      if [ -n "$TEST_USER_ADDRESS" ]; then
        echo ""
        echo "Testing portfolio endpoint with TEST_USER_ADDRESS..."
        
        # Validate address format (simple length and prefix check for zsh compatibility)
        ADDR_LEN=${#TEST_USER_ADDRESS}
        if [ "$ADDR_LEN" -ne 42 ] || [ "${TEST_USER_ADDRESS#0x}" = "$TEST_USER_ADDRESS" ]; then
          print_fail "TEST_USER_ADDRESS has invalid format (must be 0x followed by 40 hex chars)"
        else
          PORTFOLIO_URL="${BACKEND_URL}/api/portfolio/eth_testnet?userAddress=${TEST_USER_ADDRESS}"
          PORTFOLIO_RESPONSE=$(curl -s "$PORTFOLIO_URL" || echo "")
          
          if [ -z "$PORTFOLIO_RESPONSE" ]; then
            print_fail "Portfolio endpoint returned empty response"
          elif echo "$PORTFOLIO_RESPONSE" | grep -q '"error"'; then
            print_fail "Portfolio endpoint returned error"
            if command_exists jq; then
              echo "$PORTFOLIO_RESPONSE" | jq -r '.error, .message' 2>/dev/null || echo "$PORTFOLIO_RESPONSE"
            else
              echo "$PORTFOLIO_RESPONSE"
            fi
          elif echo "$PORTFOLIO_RESPONSE" | grep -q '"balances"'; then
            print_pass "Portfolio endpoint (returns balances)"
            
            if command_exists jq; then
              echo "Portfolio summary:"
              echo "$PORTFOLIO_RESPONSE" | jq -r '
                "  ETH: \(.balances.eth.formatted // "0")",
                "  USDC: \(.balances.usdc.formatted // "0")",
                "  WETH: \(.balances.weth.formatted // "0")"
              ' 2>/dev/null || echo "  (Unable to parse JSON)"
            fi
          else
            print_fail "Portfolio endpoint response missing 'balances' field"
            echo "Response: $PORTFOLIO_RESPONSE"
          fi
        fi
      else
        print_skip "Portfolio endpoint test (TEST_USER_ADDRESS not set)"
        echo "  Set TEST_USER_ADDRESS=0x... to test portfolio endpoint"
      fi
    fi
  fi
  
  # Step E: Manual steps remaining
  print_step "E" "Manual Steps Remaining"
  
  echo "The following steps require manual UI interaction:"
  echo ""
  echo -e "${YELLOW}1. Direct Mode Test:${NC}"
  echo "   • Open app in browser (http://localhost:5173 or your dev server)"
  echo "   • Connect MetaMask wallet (Sepolia network)"
  echo "   • Create a draft plan in chat"
  echo "   • Click 'Confirm & Execute'"
  echo "   • Verify: Approve transaction appears (if first time)"
  echo "   • Verify: Execute transaction appears"
  echo "   • Verify: Strategy flips to 'executed' status"
  echo "   • Verify: Transaction visible on Sepolia Etherscan"
  echo ""
  echo -e "${YELLOW}2. Session Mode Test:${NC}"
  echo "   • Set EXECUTION_AUTH_MODE=session (backend + frontend)"
  echo "   • Restart backend and frontend"
  echo "   • Create a draft plan in chat"
  echo "   • Click 'Confirm & Execute'"
  echo "   • Verify: Session creation transaction appears (one-time)"
  echo "   • Verify: Approve transaction appears (if needed, one-time)"
  echo "   • Verify: Execution happens without wallet prompt (relayed)"
  echo "   • Verify: Second execution has zero wallet prompts"
  echo ""
  
  # Final summary
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Verification Summary${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}Passed:${NC} $PASSED"
  echo -e "${YELLOW}Skipped:${NC} $SKIPPED"
  echo -e "${RED}Failed:${NC} $FAILED"
  echo ""
  
  if [ $FAILED -gt 0 ]; then
    echo -e "${RED}✖ Verification FAILED${NC}"
    echo ""
    echo "Failed steps:"
    for step in "${FAILED_STEPS[@]}"; do
      echo "  - $step"
    done
    echo ""
    echo "Fix the issues above and run the script again."
    exit 1
  else
    echo -e "${GREEN}✔ All automated checks PASSED${NC}"
    echo ""
    echo "You can now proceed with the manual UI testing steps listed above."
    exit 0
  fi
}

# Run main function
main "$@"


