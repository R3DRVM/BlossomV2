#!/bin/bash

#
# V1/V1.1 Smoke Test Script
# Asserts that the demo is running in testnet mode with all required endpoints
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

declare -a FAILURES=()
PASS_COUNT=0
FAIL_COUNT=0

# Test function
test_endpoint() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expected_key="${4:-ok}"
  local must_not_contain="${5:-}"
  
  echo -n "Testing $name... "
  
  if [ "$method" = "GET" ]; then
    response=$(curl -s --max-time 5 "$url" 2>/dev/null || echo "ERROR")
  else
    response=$(curl -s --max-time 5 -X "$method" "$url" 2>/dev/null || echo "ERROR")
  fi
  
  if [ "$response" = "ERROR" ]; then
    echo -e "${RED}❌ FAIL${NC} (connection error)"
    FAILURES+=("$name: connection error")
    ((FAIL_COUNT++))
    return 1
  fi
  
  # Check for forbidden content
  if [ -n "$must_not_contain" ] && echo "$response" | grep -q "$must_not_contain" 2>/dev/null; then
    echo -e "${RED}❌ FAIL${NC} (contains forbidden: $must_not_contain)"
    FAILURES+=("$name: contains forbidden content")
    ((FAIL_COUNT++))
    return 1
  fi
  
  if echo "$response" | grep -q "$expected_key" 2>/dev/null; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((PASS_COUNT++))
    return 0
  else
    echo -e "${RED}❌ FAIL${NC} (unexpected response)"
    echo "  Response: $response" | head -c 100
    echo ""
    FAILURES+=("$name: unexpected response")
    ((FAIL_COUNT++))
    return 1
  fi
}

echo "=========================================="
echo "V1/V1.1 Smoke Test"
echo "=========================================="
echo ""
echo "Backend URL: $BACKEND_URL"
echo ""

# Test 1: Health check must return eth_testnet mode and no missing config
echo "Test 1: Health check (executionMode=eth_testnet, no missing config)"
health_response=$(curl -s --max-time 5 "$BACKEND_URL/health" 2>/dev/null || echo "ERROR")
if [ "$health_response" = "ERROR" ]; then
  echo -e "${RED}❌ FAIL${NC} (connection error)"
  FAILURES+=("health: connection error")
  ((FAIL_COUNT++))
else
  if echo "$health_response" | grep -q '"executionMode":"eth_testnet"' 2>/dev/null; then
    echo -e "${GREEN}✅ PASS${NC} (executionMode=eth_testnet)"
    ((PASS_COUNT++))
  else
    echo -e "${RED}❌ FAIL${NC} (executionMode is not eth_testnet)"
    echo "  Response: $health_response"
    FAILURES+=("health: executionMode is not eth_testnet")
    ((FAIL_COUNT++))
  fi
  
  # Check for missing config - FAIL if ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS are missing
  if echo "$health_response" | grep -q '"missing"' 2>/dev/null; then
    if echo "$health_response" | grep -q '"ETH_TESTNET_RPC_URL"' 2>/dev/null || \
       echo "$health_response" | grep -q '"EXECUTION_ROUTER_ADDRESS"' 2>/dev/null; then
      echo -e "${RED}❌ FAIL${NC} (missing required config: ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS)"
      echo "  Response: $health_response"
      FAILURES+=("health: missing ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS")
      ((FAIL_COUNT++))
    else
      echo -e "${YELLOW}⚠️  WARNING${NC} (missing optional configuration detected)"
      echo "  Response: $health_response"
    fi
  else
    echo -e "${GREEN}✅ PASS${NC} (no missing required config)"
    ((PASS_COUNT++))
  fi
fi
echo ""

# Test 2: Preflight must return ok: true
test_endpoint "/api/execute/preflight" "GET" "$BACKEND_URL/api/execute/preflight" "ok"
echo ""

# Test 3: Wallet balances must NOT return SIM mode
echo "Test 3: Wallet balances (must NOT be SIM mode)"
balance_response=$(curl -s --max-time 5 "$BACKEND_URL/api/wallet/balances?address=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" 2>/dev/null || echo "ERROR")
if [ "$balance_response" = "ERROR" ]; then
  echo -e "${RED}❌ FAIL${NC} (connection error)"
  FAILURES+=("wallet/balances: connection error")
  ((FAIL_COUNT++))
else
  if echo "$balance_response" | grep -q "SIM mode" 2>/dev/null; then
    echo -e "${RED}❌ FAIL${NC} (returns SIM mode - not allowed in V1/V1.1)"
    FAILURES+=("wallet/balances: returns SIM mode")
    ((FAIL_COUNT++))
  else
    echo -e "${GREEN}✅ PASS${NC} (not SIM mode)"
    ((PASS_COUNT++))
  fi
fi
echo ""

# Test 4: Prices endpoint
test_endpoint "/api/prices/simple" "GET" "$BACKEND_URL/api/prices/simple?ids=ethereum&vs_currencies=usd" "ethereum"
echo ""

# Test 5: Session status
test_endpoint "/api/session/status" "GET" "$BACKEND_URL/api/session/status" "ok"
echo ""

echo "=========================================="
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "=========================================="

if [ $FAIL_COUNT -gt 0 ]; then
  echo ""
  echo "Failures:"
  for failure in "${FAILURES[@]}"; do
    echo "  - $failure"
  done
  echo ""
  echo -e "${RED}V1/V1.1 smoke test FAILED${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}All V1/V1.1 smoke tests passed!${NC}"
  exit 0
fi

