#!/bin/bash
# Demo Readiness Check Script
# Verifies that all core API contracts are working and match expected structure
# Exits non-zero if any assertion fails

set -euo pipefail

AGENT_URL="${AGENT_API_BASE_URL:-http://127.0.0.1:3001}"
FAILED=0

echo "=========================================="
echo "Demo Readiness Check"
echo "=========================================="
echo ""

# Helper function to check if a JSON key exists and is non-null
check_key() {
  local json="$1"
  local key="$2"
  local value=$(echo "$json" | jq -r ".$key // \"MISSING\"" 2>/dev/null || echo "INVALID_JSON")
  if [ "$value" = "MISSING" ] || [ "$value" = "null" ] || [ "$value" = "INVALID_JSON" ]; then
    echo "  ❌ Missing or null: $key"
    return 1
  else
    echo "  ✓ $key: present"
    return 0
  fi
}

# Helper function to check if a JSON key exists (can be null)
check_key_exists() {
  local json="$1"
  local key="$2"
  local has_key=$(echo "$json" | jq -e "has(\"$key\")" 2>/dev/null || echo "false")
  if [ "$has_key" = "true" ]; then
    echo "  ✓ $key: exists"
    return 0
  else
    echo "  ❌ Missing: $key"
    return 1
  fi
}

echo "=== 1. Environment Configuration (Redacted) ==="
echo ""
# Try to read config from health endpoint (non-sensitive)
HEALTH=$(curl -s "$AGENT_URL/api/health" || echo "{}")
if echo "$HEALTH" | jq -e '.ok == true' >/dev/null 2>&1; then
  PROVIDER=$(echo "$HEALTH" | jq -r '.llmProvider // "unknown"')
  echo "  ✓ Agent reachable"
  echo "  ✓ LLM Provider: $PROVIDER"
else
  echo "  ❌ Agent not reachable at $AGENT_URL"
  FAILED=1
fi
echo ""

echo "=== 2. Core API Endpoints ==="
echo ""

# /api/health
echo "Testing /api/health..."
HEALTH=$(curl -s "$AGENT_URL/api/health" || echo "{}")
if ! check_key "$HEALTH" "ok"; then FAILED=1; fi
if ! check_key "$HEALTH" "service"; then FAILED=1; fi
echo ""

# /api/execute/preflight
echo "Testing /api/execute/preflight..."
PREFLIGHT=$(curl -s "$AGENT_URL/api/execute/preflight" || echo "{}")
if ! check_key_exists "$PREFLIGHT" "ok"; then FAILED=1; fi
if ! check_key_exists "$PREFLIGHT" "mode"; then FAILED=1; fi
echo ""

# /api/session/status
echo "Testing /api/session/status..."
SESSION_STATUS=$(curl -s "$AGENT_URL/api/session/status" || echo "{}")
if ! check_key "$SESSION_STATUS" "ok"; then FAILED=1; fi
if ! check_key "$SESSION_STATUS" "status"; then FAILED=1; fi
if ! check_key_exists "$SESSION_STATUS" "session"; then FAILED=1; fi
echo ""

# /api/session/prepare (empty body)
echo "Testing /api/session/prepare (empty body)..."
SESSION_PREPARE=$(curl -s -X POST "$AGENT_URL/api/session/prepare" \
  -H "Content-Type: application/json" \
  -d '{}' || echo "{}")
if ! check_key "$SESSION_PREPARE" "ok"; then FAILED=1; fi
if ! check_key "$SESSION_PREPARE" "status"; then FAILED=1; fi
if ! check_key_exists "$SESSION_PREPARE" "session"; then FAILED=1; fi
echo ""

# /api/prices/simple
echo "Testing /api/prices/simple..."
PRICES=$(curl -s "$AGENT_URL/api/prices/simple?ids=ethereum&vs_currencies=usd" || echo "{}")
if ! check_key_exists "$PRICES" "ethereum"; then FAILED=1; fi
echo ""

echo "=== 3. Chat Contract Verification ==="
echo ""

# Test prompts
PROMPTS=(
  "open BTC long 2x with 2% risk"
  "bet YES on Fed rate cut with \$5"
  "park 10 usdc into yield"
)

for PROMPT in "${PROMPTS[@]}"; do
  echo "Testing prompt: \"$PROMPT\""
  
  # Call debug-chat.sh
  RESPONSE=$(curl -s -X POST "$AGENT_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "{
      \"userMessage\": \"$PROMPT\",
      \"venue\": \"hyperliquid\",
      \"clientPortfolio\": {}
    }" || echo "{}")
  
  # Check required top-level keys
  if ! check_key "$RESPONSE" "assistantMessage"; then FAILED=1; fi
  
  # Check executionRequest (should exist for actionable intents)
  EXEC_REQ=$(echo "$RESPONSE" | jq -r '.executionRequest // null' 2>/dev/null)
  if [ "$EXEC_REQ" = "null" ] || [ -z "$EXEC_REQ" ]; then
    echo "  ⚠️  executionRequest missing (may be OK for non-actionable prompts)"
  else
    echo "  ✓ executionRequest: present"
    # Check executionRequest.kind
    KIND=$(echo "$RESPONSE" | jq -r '.executionRequest.kind // "none"' 2>/dev/null)
    if [ "$KIND" != "none" ]; then
      echo "  ✓ executionRequest.kind: $KIND"
    else
      echo "  ❌ executionRequest.kind missing"
      FAILED=1
    fi
  fi
  
  echo ""
done

echo "=== 4. Draft Creation Verification ==="
echo ""

# For perp/event/DeFi, verify that the frontend would create a draft
# (We can't directly verify draft creation from backend, but we can verify
# that executionRequest has the required fields for draft creation)

echo "Verifying executionRequest structure for draft creation..."
echo ""

# Perp prompt
PERP_RESPONSE=$(curl -s -X POST "$AGENT_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "open BTC long 2x with 2% risk",
    "venue": "hyperliquid",
    "clientPortfolio": {}
  }' || echo "{}")

PERP_EXEC_REQ=$(echo "$PERP_RESPONSE" | jq '.executionRequest // null' 2>/dev/null)
if [ "$PERP_EXEC_REQ" != "null" ] && [ -n "$PERP_EXEC_REQ" ]; then
  PERP_KIND=$(echo "$PERP_EXEC_REQ" | jq -r '.kind // "none"' 2>/dev/null)
  if [ "$PERP_KIND" = "perp" ]; then
    echo "  ✓ Perp executionRequest.kind: perp"
    # Check required perp fields
    if echo "$PERP_EXEC_REQ" | jq -e '.market' >/dev/null 2>&1; then
      echo "  ✓ Perp executionRequest.market: present"
    else
      echo "  ❌ Perp executionRequest.market: missing"
      FAILED=1
    fi
    if echo "$PERP_EXEC_REQ" | jq -e '.side' >/dev/null 2>&1; then
      echo "  ✓ Perp executionRequest.side: present"
    else
      echo "  ❌ Perp executionRequest.side: missing"
      FAILED=1
    fi
  else
    echo "  ⚠️  Perp prompt returned kind: $PERP_KIND (expected: perp)"
  fi
else
  echo "  ❌ Perp executionRequest missing"
  FAILED=1
fi
echo ""

# Event prompt
EVENT_RESPONSE=$(curl -s -X POST "$AGENT_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "bet YES on Fed rate cut with $5",
    "venue": "hyperliquid",
    "clientPortfolio": {}
  }' || echo "{}")

EVENT_EXEC_REQ=$(echo "$EVENT_RESPONSE" | jq '.executionRequest // null' 2>/dev/null)
if [ "$EVENT_EXEC_REQ" != "null" ] && [ -n "$EVENT_EXEC_REQ" ]; then
  EVENT_KIND=$(echo "$EVENT_EXEC_REQ" | jq -r '.kind // "none"' 2>/dev/null)
  if [ "$EVENT_KIND" = "event" ]; then
    echo "  ✓ Event executionRequest.kind: event"
    # Check required event fields
    if echo "$EVENT_EXEC_REQ" | jq -e '.marketId' >/dev/null 2>&1; then
      echo "  ✓ Event executionRequest.marketId: present"
    else
      echo "  ❌ Event executionRequest.marketId: missing"
      FAILED=1
    fi
    if echo "$EVENT_EXEC_REQ" | jq -e '.outcome' >/dev/null 2>&1; then
      echo "  ✓ Event executionRequest.outcome: present"
    else
      echo "  ❌ Event executionRequest.outcome: missing"
      FAILED=1
    fi
    if echo "$EVENT_EXEC_REQ" | jq -e '.stakeUsd' >/dev/null 2>&1; then
      echo "  ✓ Event executionRequest.stakeUsd: present"
    else
      echo "  ❌ Event executionRequest.stakeUsd: missing"
      FAILED=1
    fi
  else
    echo "  ⚠️  Event prompt returned kind: $EVENT_KIND (expected: event)"
  fi
else
  echo "  ❌ Event executionRequest missing"
  FAILED=1
fi
echo ""

# DeFi prompt
DEFI_RESPONSE=$(curl -s -X POST "$AGENT_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "park 10 usdc into yield",
    "venue": "hyperliquid",
    "clientPortfolio": {}
  }' || echo "{}")

DEFI_EXEC_REQ=$(echo "$DEFI_RESPONSE" | jq '.executionRequest // null' 2>/dev/null)
if [ "$DEFI_EXEC_REQ" != "null" ] && [ -n "$DEFI_EXEC_REQ" ]; then
  DEFI_KIND=$(echo "$DEFI_EXEC_REQ" | jq -r '.kind // "none"' 2>/dev/null)
  if [ "$DEFI_KIND" = "lend" ] || [ "$DEFI_KIND" = "lend_supply" ]; then
    echo "  ✓ DeFi executionRequest.kind: $DEFI_KIND"
    # Check required DeFi fields
    if echo "$DEFI_EXEC_REQ" | jq -e '.asset' >/dev/null 2>&1; then
      echo "  ✓ DeFi executionRequest.asset: present"
    else
      echo "  ❌ DeFi executionRequest.asset: missing"
      FAILED=1
    fi
    if echo "$DEFI_EXEC_REQ" | jq -e '.amount' >/dev/null 2>&1; then
      echo "  ✓ DeFi executionRequest.amount: present"
    else
      echo "  ❌ DeFi executionRequest.amount: missing"
      FAILED=1
    fi
  else
    echo "  ⚠️  DeFi prompt returned kind: $DEFI_KIND (expected: lend or lend_supply)"
  fi
else
  echo "  ❌ DeFi executionRequest missing"
  FAILED=1
fi
echo ""

echo "=== 5. Execution Preflight Check ==="
echo ""

# Test execution prepare for each intent type
# Note: Static call (eth_call) verification happens in frontend (walletAdapter.ts)
# This check verifies that /api/execute/prepare returns valid transaction data

echo "Testing /api/execute/prepare for perp intent..."
PERP_PREPARE=$(curl -s -X POST "$AGENT_URL/api/execute/prepare" \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "test-perp-draft",
    "userAddress": "0x0000000000000000000000000000000000000000",
    "strategy": {
      "market": "BTC-USD",
      "side": "Long",
      "riskPercent": 2,
      "leverage": 2
    },
    "authMode": "direct",
    "executionRequest": {
      "kind": "perp",
      "chain": "sepolia",
      "market": "BTC-USD",
      "side": "long",
      "leverage": 2,
      "riskPct": 2
    }
  }' || echo "{}")

if echo "$PERP_PREPARE" | jq -e '.to' >/dev/null 2>&1 && echo "$PERP_PREPARE" | jq -e '.data' >/dev/null 2>&1; then
  echo "  ✓ Perp prepare: to and data present"
  PREPARE_TO=$(echo "$PERP_PREPARE" | jq -r '.to // "none"')
  PREPARE_CHAIN_ID=$(echo "$PERP_PREPARE" | jq -r '.chainId // "none"')
  if [ "$PREPARE_CHAIN_ID" = "11155111" ]; then
    echo "  ✓ Perp prepare: chainId=11155111 (Sepolia)"
  else
    echo "  ⚠️  Perp prepare: chainId=$PREPARE_CHAIN_ID (expected: 11155111)"
  fi
  if echo "$PERP_PREPARE" | jq -e '.routing' >/dev/null 2>&1; then
    ROUTING_CHAIN=$(echo "$PERP_PREPARE" | jq -r '.routing.chain // "none"')
    if [ "$ROUTING_CHAIN" = "Sepolia" ]; then
      echo "  ✓ Perp prepare: routing.chain=Sepolia"
    else
      echo "  ⚠️  Perp prepare: routing.chain=$ROUTING_CHAIN (expected: Sepolia)"
    fi
  fi
else
  echo "  ❌ Perp prepare: missing to or data"
  FAILED=1
fi
echo ""

echo "Testing /api/execute/prepare for event intent..."
EVENT_PREPARE=$(curl -s -X POST "$AGENT_URL/api/execute/prepare" \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "test-event-draft",
    "userAddress": "0x0000000000000000000000000000000000000000",
    "strategy": {
      "market": "fed-rate-cut",
      "side": "Long",
      "stakeUsd": 5
    },
    "authMode": "direct",
    "executionRequest": {
      "kind": "event",
      "chain": "sepolia",
      "marketId": "fed-rate-cut",
      "outcome": "YES",
      "stakeUsd": 5
    }
  }' || echo "{}")

if echo "$EVENT_PREPARE" | jq -e '.to' >/dev/null 2>&1 && echo "$EVENT_PREPARE" | jq -e '.data' >/dev/null 2>&1; then
  echo "  ✓ Event prepare: to and data present"
  PREPARE_CHAIN_ID=$(echo "$EVENT_PREPARE" | jq -r '.chainId // "none"')
  if [ "$PREPARE_CHAIN_ID" = "11155111" ]; then
    echo "  ✓ Event prepare: chainId=11155111 (Sepolia)"
  else
    echo "  ⚠️  Event prepare: chainId=$PREPARE_CHAIN_ID (expected: 11155111)"
  fi
else
  echo "  ❌ Event prepare: missing to or data"
  FAILED=1
fi
echo ""

echo "Testing /api/execute/prepare for DeFi intent..."
DEFI_PREPARE=$(curl -s -X POST "$AGENT_URL/api/execute/prepare" \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "test-defi-draft",
    "userAddress": "0x0000000000000000000000000000000000000000",
    "strategy": {
      "market": "Aave REDACTED",
      "side": "Long",
      "marginUsd": 10
    },
    "authMode": "direct",
    "executionRequest": {
      "kind": "lend",
      "chain": "sepolia",
      "asset": "REDACTED",
      "amount": "10"
    }
  }' || echo "{}")

if echo "$DEFI_PREPARE" | jq -e '.to' >/dev/null 2>&1 && echo "$DEFI_PREPARE" | jq -e '.data' >/dev/null 2>&1; then
  echo "  ✓ DeFi prepare: to and data present"
  PREPARE_CHAIN_ID=$(echo "$DEFI_PREPARE" | jq -r '.chainId // "none"')
  if [ "$PREPARE_CHAIN_ID" = "11155111" ]; then
    echo "  ✓ DeFi prepare: chainId=11155111 (Sepolia)"
  else
    echo "  ⚠️  DeFi prepare: chainId=$PREPARE_CHAIN_ID (expected: 11155111)"
  fi
else
  echo "  ❌ DeFi prepare: missing to or data"
  FAILED=1
fi
echo ""

echo "Note: Static call (eth_call) verification happens in frontend (walletAdapter.ts)"
echo "      This ensures transactions won't revert before prompting MetaMask."
echo ""

echo "=========================================="
if [ $FAILED -eq 0 ]; then
  echo "✅ All checks passed!"
  echo "=========================================="
  exit 0
else
  echo "❌ Some checks failed. Review output above."
  echo "=========================================="
  exit 1
fi
