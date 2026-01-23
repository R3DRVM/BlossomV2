#!/bin/bash
# Debug script to capture exact /api/chat JSON response

AGENT_URL="${AGENT_API_BASE_URL:-http://127.0.0.1:3001}"
PROMPT="${1:-swap 5 usdc to weth}"

echo "=== Debug Chat Response ==="
echo "Prompt: $PROMPT"
echo "Agent URL: $AGENT_URL"
echo ""

# Send request matching frontend format
RESPONSE=$(curl -s -X POST "$AGENT_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d "{
    \"userMessage\": \"$PROMPT\",
    \"venue\": \"hyperliquid\",
    \"clientPortfolio\": {}
  }")

echo "=== Response Keys ==="
echo "$RESPONSE" | jq -r 'keys[]' 2>/dev/null || echo "Invalid JSON or jq not installed"

echo ""
echo "=== executionRequest ==="
echo "$RESPONSE" | jq '.executionRequest' 2>/dev/null || echo "Missing or invalid"

echo ""
echo "=== actions ==="
echo "$RESPONSE" | jq '.actions' 2>/dev/null || echo "Missing or invalid"

echo ""
echo "=== portfolio.strategies ==="
echo "$RESPONSE" | jq '.portfolio.strategies' 2>/dev/null || echo "Missing or invalid"

echo ""
echo ""
echo "=== Card Contract (Task C) ==="
if [ "$DEBUG_CARD_CONTRACT" = "true" ]; then
  echo "executionRequest.kind: $(echo "$RESPONSE" | jq -r '.executionRequest.kind // "none"')"
  echo "draftId: $(echo "$RESPONSE" | jq -r '.draftId // "none"')"
  echo "portfolio.strategies count: $(echo "$RESPONSE" | jq '.portfolio.strategies | length')"
  echo "portfolio.strategies (drafts): $(echo "$RESPONSE" | jq '[.portfolio.strategies[] | select(.status == "draft") | {id, type, status, market, side, marginUsd, leverage, notionalUsd}]')"
fi

echo ""
echo "=== Full Response (redacted) ==="
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

