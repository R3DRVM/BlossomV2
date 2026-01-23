#!/bin/bash
#
# Endpoint Smoke Test Script
# Tests all registered API endpoints and fails loudly if something is broken
#
# Usage:
#   ./scripts/endpoint-smoke-test.sh [BASE_URL]
#
# Example:
#   ./scripts/endpoint-smoke-test.sh http://localhost:3001
#

# Use set -euo pipefail only where safe (avoid issues with pipefail in zsh)
set -eu

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default base URL
BASE_URL="${1:-http://localhost:3001}"

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Test result tracking
FAILED_TESTS=()

echo "🧪 Blossom Agent Endpoint Smoke Test"
echo "======================================"
echo "Base URL: $BASE_URL"
echo ""

# Helper function to make HTTP requests
test_endpoint() {
  local method=$1
  local path=$2
  local description=$3
  local expected_status=${4:-200}
  local data=${5:-}
  local skip_condition=${6:-}

  # Check skip condition
  if [ -n "$skip_condition" ] && eval "$skip_condition"; then
    echo -e "${YELLOW}⏭  SKIP${NC} $method $path - $description"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  local url="${BASE_URL}${path}"
  local curl_opts=(-s -w "\n%{http_code}" -X "$method")
  
  if [ -n "$data" ]; then
    curl_opts+=(-H "Content-Type: application/json" -d "$data")
  fi

  local response
  local curl_exit=0
  response=$(curl "${curl_opts[@]}" "$url" 2>&1) || curl_exit=$?
  
  if [ $curl_exit -ne 0 ]; then
    echo -e "${RED}✗ FAIL${NC} $method $path - $description"
    echo "  Error: curl failed (exit code: $curl_exit)"
    echo "  URL: $url"
    if [ -n "$response" ]; then
      echo "  Response: $response"
    fi
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("$method $path")
    return 1
  fi

  # Extract status code (last line) and body (all but last line)
  local status_code
  status_code=$(echo "$response" | tail -n1)
  local body
  body=$(echo "$response" | sed '$d')

  # Check if expected_status is a pattern (e.g., "400|500")
  local status_match=0
  if echo "$expected_status" | grep -q '|'; then
    # Multiple acceptable status codes
    local status_pattern="$expected_status"
    for status in $(echo "$status_pattern" | tr '|' ' '); do
      if [ "$status_code" -eq "$status" ]; then
        status_match=1
        break
      fi
    done
  else
    # Single expected status code
    if [ "$status_code" -eq "$expected_status" ]; then
      status_match=1
    fi
  fi

  if [ $status_match -eq 1 ]; then
    echo -e "${GREEN}✓ PASS${NC} $method $path - $description (${status_code})"
    PASSED=$((PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC} $method $path - $description"
    echo "  Expected: $expected_status, Got: $status_code"
    if [ -n "$body" ]; then
      echo "  Response: $body"
    fi
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("$method $path")
    return 1
  fi
}

# Helper: Wait for backend health endpoint with retries
wait_for_health() {
  local max_attempts=10
  local attempt=1
  local wait_seconds=1
  
  echo "Checking backend health..."
  
  while [ $attempt -le $max_attempts ]; do
    if curl -s -f --max-time 2 "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    
    if [ $attempt -lt $max_attempts ]; then
      sleep $wait_seconds
    fi
    attempt=$((attempt + 1))
  done
  
  return 1
}

# Test 1: Health check (always available)
echo "📋 Testing Core Endpoints"
echo "-------------------------"

# Check health with retries
if ! wait_for_health; then
  echo ""
  echo -e "${RED}✗ FAIL${NC} Backend not running"
  echo ""
  echo "The backend is not responding at ${BASE_URL}/health"
  echo ""
  echo "To start the backend, run:"
  echo "  cd agent && PORT=3001 npm run dev"
  echo ""
  echo "Or use the verification script with auto-start:"
  echo "  ./scripts/mvp-verify.sh --start-backend"
  echo ""
  exit 1
fi

test_endpoint "GET" "/health" "Health check"

# Test 2: Ticker (always available)
test_endpoint "GET" "/api/ticker" "Get ticker data"
test_endpoint "GET" "/api/ticker?venue=event_demo" "Get event markets ticker"

# Test 3: Chat endpoint (always available, but may return stub response)
test_endpoint "POST" "/api/chat" "Chat endpoint" 200 '{"userMessage":"test","venue":"hyperliquid"}'

# Test 4: Strategy close (always available, accepts 400 or 500 for invalid input)
test_endpoint "POST" "/api/strategy/close" "Close strategy" "400|500" '{"strategyId":"test","type":"perp"}'

# Test 5: Reset (always available)
test_endpoint "POST" "/api/reset" "Reset simulation"

# Test 6: Portfolio endpoint (eth_testnet mode only)
echo ""
echo "📋 Testing ETH Testnet Endpoints"
echo "-------------------------------"

# Check if EXECUTION_MODE is set to eth_testnet
if [ "${EXECUTION_MODE:-}" != "eth_testnet" ]; then
  SKIP_TESTNET=true
else
  SKIP_TESTNET=false
fi

test_endpoint "GET" "/api/portfolio/eth_testnet?userAddress=0x1234567890123456789012345678901234567890" \
  "Portfolio endpoint (eth_testnet mode)" "400|500" \
  "" \
  "$SKIP_TESTNET"

# Test 7: Execute prepare (eth_testnet mode only)
test_endpoint "POST" "/api/execute/prepare" \
  "Execute prepare (eth_testnet mode)" 400 \
  '{"draftId":"test","userAddress":"0x1234567890123456789012345678901234567890"}' \
  "$SKIP_TESTNET"

# Test 8: Execute submit (always available, but validates input)
test_endpoint "POST" "/api/execute/submit" \
  "Execute submit" 400 \
  '{"draftId":"test"}'

test_endpoint "POST" "/api/execute/submit" \
  "Execute submit (invalid txHash)" "200|400|500" \
  '{"draftId":"test","txHash":"0x123"}'

# Test 9: Preflight check
test_endpoint "GET" "/api/execute/preflight" "Preflight check"

# Test 10: Session prepare (session mode only)
if [ "${EXECUTION_MODE:-}" != "eth_testnet" ] || [ "${EXECUTION_AUTH_MODE:-}" != "session" ]; then
  SKIP_SESSION=true
else
  SKIP_SESSION=false
fi

test_endpoint "POST" "/api/session/prepare" \
  "Session prepare (session mode)" 400 \
  '{"userAddress":"0x1234567890123456789012345678901234567890"}' \
  "$SKIP_SESSION"

# Test 11: Execute relayed (session mode only)
test_endpoint "POST" "/api/execute/relayed" \
  "Execute relayed (session mode)" 400 \
  '{"draftId":"test","userAddress":"0x1234567890123456789012345678901234567890","plan":{},"sessionId":"0x1234"}' \
  "$SKIP_SESSION"

# Test 12: Token approve prepare (always available, but validates input)
test_endpoint "POST" "/api/token/approve/prepare" \
  "Token approve prepare (missing params)" 400 \
  '{}'

test_endpoint "POST" "/api/token/approve/prepare" \
  "Token approve prepare (invalid address)" 400 \
  '{"token":"invalid","spender":"0x1234567890123456789012345678901234567890","amount":"1000000","userAddress":"0x1234567890123456789012345678901234567890"}'

# Summary
echo ""
echo "======================================"
echo "📊 Test Summary"
echo "======================================"
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${YELLOW}Skipped:${NC} $SKIPPED"
echo -e "${RED}Failed:${NC} $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}❌ Smoke test failed!${NC}"
  echo ""
  echo "Failed tests:"
  for test in "${FAILED_TESTS[@]}"; do
    echo "  - $test"
  done
  exit 1
else
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
fi

