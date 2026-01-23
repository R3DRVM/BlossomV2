#!/bin/bash

#
# Demo Smoke Test Script
# Quick health check for all critical endpoints
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
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
echo "Demo Smoke Test"
echo "=========================================="
echo ""
echo "Backend URL: $BACKEND_URL"
echo ""

# Test endpoints
test_endpoint "/health" "GET" "$BACKEND_URL/health" "ok"
test_endpoint "/api/health" "GET" "$BACKEND_URL/api/health" "ok"
test_endpoint "/api/execute/preflight" "GET" "$BACKEND_URL/api/execute/preflight" "ok"
test_endpoint "/api/session/status" "GET" "$BACKEND_URL/api/session/status?userAddress=0x0000000000000000000000000000000000000000" "ok"
test_endpoint "/api/prices/eth" "GET" "$BACKEND_URL/api/prices/eth" "priceUsd"
test_endpoint "/api/prices/simple" "GET" "$BACKEND_URL/api/prices/simple?ids=ethereum,bitcoin&vs_currencies=usd" "ethereum"
test_endpoint "/api/wallet/balances" "GET" "$BACKEND_URL/api/wallet/balances?address=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" "address"

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
  exit 1
else
  echo ""
  echo -e "${GREEN}All smoke tests passed!${NC}"
  exit 0
fi

