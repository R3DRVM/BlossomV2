#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "${EXECUTION_ROUTER_ADDRESS:-}" ]; then
  echo -e "${RED}ERROR: EXECUTION_ROUTER_ADDRESS is not set${NC}"
  exit 1
fi

if [ -z "${RELAYER_PRIVATE_KEY:-}" ]; then
  echo -e "${RED}ERROR: RELAYER_PRIVATE_KEY is not set${NC}"
  exit 1
fi

RPC_URL="${ETH_TESTNET_RPC_URL:-}"
if [ -z "$RPC_URL" ]; then
  echo -e "${RED}ERROR: ETH_TESTNET_RPC_URL is not set${NC}"
  exit 1
fi

ADAPTERS=(
  "${MOCK_SWAP_ADAPTER_ADDRESS:-}"
  "${UNISWAP_V3_ADAPTER_ADDRESS:-}"
  "${ERC20_PULL_ADAPTER_ADDRESS:-}"
  "${WETH_WRAP_ADAPTER_ADDRESS:-}"
  "${DEMO_LEND_ADAPTER_ADDRESS:-}"
  "${DEMO_PERP_ADAPTER_ADDRESS:-}"
  "${DEMO_EVENT_ADAPTER_ADDRESS:-}"
  "${PROOF_ADAPTER_ADDRESS:-}"
  "${AAVE_ADAPTER_ADDRESS:-}"
)

echo -e "${YELLOW}Allowlisting adapters on ExecutionRouter:${NC} $EXECUTION_ROUTER_ADDRESS"
echo -e "${YELLOW}RPC:${NC} $RPC_URL"

for adapter in "${ADAPTERS[@]}"; do
  if [ -z "$adapter" ]; then
    continue
  fi
  echo -e "\nChecking adapter: $adapter"
  IS_ALLOWED=$(cast call "$EXECUTION_ROUTER_ADDRESS" \
    "isAdapterAllowed(address)(bool)" \
    "$adapter" \
    --rpc-url "$RPC_URL")

  if [ "$IS_ALLOWED" = "true" ]; then
    echo -e "${GREEN}Already allowlisted${NC}"
    continue
  fi

  echo -e "${YELLOW}Allowlisting...${NC}"
  cast send "$EXECUTION_ROUTER_ADDRESS" \
    "setAdapterAllowed(address,bool)" \
    "$adapter" true \
    --rpc-url "$RPC_URL" \
    --private-key "$RELAYER_PRIVATE_KEY" >/dev/null

  IS_ALLOWED_AFTER=$(cast call "$EXECUTION_ROUTER_ADDRESS" \
    "isAdapterAllowed(address)(bool)" \
    "$adapter" \
    --rpc-url "$RPC_URL")

  if [ "$IS_ALLOWED_AFTER" = "true" ]; then
    echo -e "${GREEN}Allowlisted${NC}"
  else
    echo -e "${RED}Failed to allowlist${NC}"
  fi
done

echo -e "\n${GREEN}Allowlist sync complete.${NC}"
