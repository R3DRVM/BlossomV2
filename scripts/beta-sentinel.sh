#!/usr/bin/env bash
# Beta Sentinel - Quick production health check
# Usage: bash scripts/beta-sentinel.sh
# Runs 3 actions (swap, perp, deposit) + relayer check + stats verification

set -euo pipefail

API="https://api.blossom.onl"
SECRET="${DEV_LEDGER_SECRET:-puybv9ndRTquX68aKbxC1hszx3BymM6f}"
WALLET="0x158Ef361B3e3ce4bf4a93a43EFc313c979fb4321"
PASS=0
FAIL=0
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "============================================"
echo "  BETA SENTINEL - $TS"
echo "============================================"
echo ""

# --- Health Check ---
echo "--- HEALTH ---"
HEALTH=$(curl -s --max-time 10 "$API/api/health")
HEALTH_OK=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "false")
BASE_READY=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('baseSepolia',{}).get('ready',False))" 2>/dev/null || echo "false")
echo "  API ok: $HEALTH_OK"
echo "  baseSepolia.ready: $BASE_READY"
if [ "$HEALTH_OK" != "True" ] || [ "$BASE_READY" != "True" ]; then
  echo "  *** ALERT: Health check FAILED ***"
  FAIL=$((FAIL+1))
else
  PASS=$((PASS+1))
fi
echo ""

# --- Relayer Check ---
echo "--- RELAYER ---"
RELAYER=$(curl -s --max-time 10 "$API/api/relayer/status")
RELAYER_BAL=$(echo "$RELAYER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('relayer',{}).get('balanceEth','0'))" 2>/dev/null || echo "0")
RELAYER_OK=$(echo "$RELAYER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('relayer',{}).get('okToExecute',False))" 2>/dev/null || echo "false")
echo "  balance: $RELAYER_BAL ETH"
echo "  okToExecute: $RELAYER_OK"
if [ "$RELAYER_OK" != "True" ]; then
  echo "  *** ALERT: Relayer NOT ok to execute ***"
  FAIL=$((FAIL+1))
else
  PASS=$((PASS+1))
fi
echo ""

# --- Action 1: Swap ---
echo "--- SWAP ---"
SWAP=$(curl -s --max-time 30 -X POST "$API/api/ledger/intents/execute" \
  -H "Content-Type: application/json" \
  -H "X-Ledger-Secret: $SECRET" \
  -d "{\"intentText\":\"swap 1 bUSDC for WETH\",\"chain\":\"ethereum\",\"planOnly\":false,\"metadata\":{\"userAddress\":\"$WALLET\",\"walletAddress\":\"$WALLET\",\"toChain\":\"base_sepolia\",\"source\":\"sentinel\"}}")
SWAP_OK=$(echo "$SWAP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "false")
SWAP_ID=$(echo "$SWAP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intentId',''))" 2>/dev/null || echo "")
SWAP_TX=$(echo "$SWAP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('txHash',''))" 2>/dev/null || echo "")
echo "  ok: $SWAP_OK | intentId: $SWAP_ID | txHash: ${SWAP_TX:0:16}..."
if [ "$SWAP_OK" = "True" ] && [ -n "$SWAP_ID" ] && [ -n "$SWAP_TX" ]; then
  PASS=$((PASS+1))
else
  echo "  *** ALERT: Swap FAILED ***"
  FAIL=$((FAIL+1))
fi
echo ""

# --- Action 2: Perp Open ---
echo "--- PERP OPEN ---"
PERP_RAW=$(curl -s --max-time 30 -X POST "$API/api/ledger/intents/execute" \
  -H "Content-Type: application/json" \
  -H "X-Ledger-Secret: $SECRET" \
  -d "{\"intentText\":\"Open 0.005 ETH long BTC\",\"chain\":\"ethereum\",\"planOnly\":false,\"metadata\":{\"userAddress\":\"$WALLET\",\"walletAddress\":\"$WALLET\",\"toChain\":\"base_sepolia\",\"source\":\"sentinel\"}}")
# Clean control chars for perp response
PERP=$(echo "$PERP_RAW" | tr -d '\000-\037' | tr -d '\177')
PERP_OK=$(echo "$PERP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "false")
PERP_ID=$(echo "$PERP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intentId',''))" 2>/dev/null || echo "")
PERP_TX=$(echo "$PERP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('txHash',''))" 2>/dev/null || echo "")
echo "  ok: $PERP_OK | intentId: $PERP_ID | txHash: ${PERP_TX:0:16}..."
if [ "$PERP_OK" = "True" ] && [ -n "$PERP_ID" ] && [ -n "$PERP_TX" ]; then
  PASS=$((PASS+1))
else
  echo "  *** ALERT: Perp FAILED ***"
  FAIL=$((FAIL+1))
fi
echo ""

# --- Action 3: Deposit ---
echo "--- DEPOSIT ---"
DEP=$(curl -s --max-time 30 -X POST "$API/api/ledger/intents/execute" \
  -H "Content-Type: application/json" \
  -H "X-Ledger-Secret: $SECRET" \
  -d "{\"intentText\":\"Deposit 5 bUSDC into Aave\",\"chain\":\"ethereum\",\"planOnly\":false,\"metadata\":{\"userAddress\":\"$WALLET\",\"walletAddress\":\"$WALLET\",\"toChain\":\"base_sepolia\",\"source\":\"sentinel\"}}")
DEP_OK=$(echo "$DEP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "false")
DEP_ID=$(echo "$DEP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('intentId',''))" 2>/dev/null || echo "")
DEP_TX=$(echo "$DEP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('txHash',''))" 2>/dev/null || echo "")
echo "  ok: $DEP_OK | intentId: $DEP_ID | txHash: ${DEP_TX:0:16}..."
if [ "$DEP_OK" = "True" ] && [ -n "$DEP_ID" ] && [ -n "$DEP_TX" ]; then
  PASS=$((PASS+1))
else
  echo "  *** ALERT: Deposit FAILED ***"
  FAIL=$((FAIL+1))
fi
echo ""

# --- Stats Check ---
echo "--- STATS ---"
STATS=$(curl -s --max-time 10 "$API/api/stats/public")
TOTAL=$(echo "$STATS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('totalIntents',0))" 2>/dev/null || echo "0")
CONFIRMED=$(echo "$STATS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('confirmedIntents',0))" 2>/dev/null || echo "0")
RATE=$(echo "$STATS" | python3 -c "import json,sys; print(f\"{json.load(sys.stdin).get('data',{}).get('successRate',0):.1f}\")" 2>/dev/null || echo "0")
echo "  totalIntents: $TOTAL | confirmed: $CONFIRMED | rate: ${RATE}%"

# Verify our swap intent appeared
if [ -n "$SWAP_ID" ]; then
  sleep 2
  STATS_CHECK=$(curl -s --max-time 10 "$API/api/ledger/intents/$SWAP_ID" -H "X-Ledger-Secret: $SECRET")
  STATS_FOUND=$(echo "$STATS_CHECK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "false")
  echo "  Swap in stats: $STATS_FOUND"
  if [ "$STATS_FOUND" = "True" ]; then
    PASS=$((PASS+1))
  else
    echo "  *** ALERT: Stats lag > expected ***"
    FAIL=$((FAIL+1))
  fi
fi
echo ""

# --- Summary ---
TOTAL_CHECKS=$((PASS+FAIL))
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  echo "  SENTINEL: ALL CLEAR ($PASS/$TOTAL_CHECKS checks passed)"
else
  echo "  SENTINEL: $FAIL ALERT(S) ($PASS/$TOTAL_CHECKS passed)"
  echo "  Review alerts above. If 3+ failures: PAUSE LAUNCH."
fi
echo "  Timestamp: $TS"
echo "============================================"
