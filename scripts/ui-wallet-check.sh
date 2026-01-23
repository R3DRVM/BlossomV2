#!/bin/bash

# UI Wallet Check Script
# Verifies wallet endpoints respond quickly (for wallet readiness)

set -e

BASE_URL="http://127.0.0.1:3001"
TIMEOUT=3

echo "=========================================="
echo "UI Wallet Readiness Check"
echo "=========================================="
echo ""

# Test 1: Health endpoint (must return quickly)
echo "Test 1: Health check (must return < ${TIMEOUT}s)"
START=$(date +%s%N)
HEALTH_RESPONSE=$(curl -s --max-time $TIMEOUT "$BASE_URL/health" || echo "")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

if [ -z "$HEALTH_RESPONSE" ]; then
  echo "❌ FAIL: Health endpoint timed out or unreachable"
  exit 1
fi

if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
  echo "✅ PASS (${DURATION_MS}ms)"
else
  echo "❌ FAIL: Health returned ok:false"
  echo "   Response: $HEALTH_RESPONSE" | head -c 200
  exit 1
fi
echo ""

# Test 2: Session status endpoint (must return quickly)
echo "Test 2: Session status (must return < ${TIMEOUT}s)"
START=$(date +%s%N)
SESSION_RESPONSE=$(curl -s --max-time $TIMEOUT -X POST "$BASE_URL/api/session/status" \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"0x0000000000000000000000000000000000000000"}' || echo "")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

if [ -z "$SESSION_RESPONSE" ]; then
  echo "❌ FAIL: Session status endpoint timed out or unreachable"
  exit 1
fi

if echo "$SESSION_RESPONSE" | grep -q '"ok":true'; then
  echo "✅ PASS (${DURATION_MS}ms)"
else
  echo "⚠️  WARN: Session status returned ok:false (non-blocking in direct mode)"
  echo "   Response: $SESSION_RESPONSE" | head -c 200
fi
echo ""

# Test 3: Wallet balances endpoint (must return quickly)
echo "Test 3: Wallet balances (must return < ${TIMEOUT}s)"
START=$(date +%s%N)
BALANCES_RESPONSE=$(curl -s --max-time $TIMEOUT "$BASE_URL/api/wallet/balances?address=0x0000000000000000000000000000000000000000" || echo "")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

if [ -z "$BALANCES_RESPONSE" ]; then
  echo "❌ FAIL: Wallet balances endpoint timed out or unreachable"
  exit 1
fi

# Accept both success (200) and error (503) responses - both should return quickly
if echo "$BALANCES_RESPONSE" | grep -q '"ok":true\|"ok":false'; then
  echo "✅ PASS (${DURATION_MS}ms)"
else
  echo "❌ FAIL: Wallet balances returned unexpected response"
  echo "   Response: $BALANCES_RESPONSE" | head -c 200
  exit 1
fi
echo ""

echo "=========================================="
echo "Results: All wallet endpoints respond quickly"
echo "=========================================="
echo ""
echo "✅ Wallet readiness check passed!"
echo "   All endpoints return within ${TIMEOUT}s timeout"
echo ""


