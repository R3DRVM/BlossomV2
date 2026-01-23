#!/bin/bash
# Allowlist Aave Adapter in ExecutionRouter
# Use this if deployer is not the router owner, or if adapter was deployed separately

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Allowlist Aave Adapter ===${NC}\n"

# Check required env vars
if [ -z "$SEPOLIA_RPC_URL" ]; then
    echo -e "${RED}ERROR: SEPOLIA_RPC_URL environment variable is not set${NC}"
    exit 1
fi

if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: DEPLOYER_PRIVATE_KEY environment variable is not set${NC}"
    exit 1
fi

if [ -z "$EXECUTION_ROUTER_ADDRESS" ]; then
    echo -e "${RED}ERROR: EXECUTION_ROUTER_ADDRESS environment variable is not set${NC}"
    exit 1
fi

if [ -z "$AAVE_ADAPTER_ADDRESS" ]; then
    echo -e "${RED}ERROR: AAVE_ADAPTER_ADDRESS environment variable is not set${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Environment variables set${NC}"
echo "  Router: $EXECUTION_ROUTER_ADDRESS"
echo "  Adapter: $AAVE_ADAPTER_ADDRESS"
echo ""

# Check if adapter is already allowlisted
echo "Checking current allowlist status..."
IS_ALLOWED=$(cast call "$EXECUTION_ROUTER_ADDRESS" \
  "isAdapterAllowed(address)(bool)" \
  "$AAVE_ADAPTER_ADDRESS" \
  --rpc-url "$SEPOLIA_RPC_URL")

if [ "$IS_ALLOWED" = "true" ]; then
    echo -e "${GREEN}✓ Adapter is already allowlisted${NC}"
    exit 0
fi

echo -e "${YELLOW}Adapter is not allowlisted. Adding to allowlist...${NC}"

# Allowlist adapter
cast send "$EXECUTION_ROUTER_ADDRESS" \
  "setAdapterAllowed(address,bool)" \
  "$AAVE_ADAPTER_ADDRESS" true \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

echo ""
echo -e "${GREEN}✓ Adapter allowlisted successfully${NC}"

# Verify
IS_ALLOWED_AFTER=$(cast call "$EXECUTION_ROUTER_ADDRESS" \
  "isAdapterAllowed(address)(bool)" \
  "$AAVE_ADAPTER_ADDRESS" \
  --rpc-url "$SEPOLIA_RPC_URL")

if [ "$IS_ALLOWED_AFTER" = "true" ]; then
    echo -e "${GREEN}✓ Verification: Adapter is allowlisted${NC}"
else
    echo -e "${RED}✗ Verification failed: Adapter is not allowlisted${NC}"
    exit 1
fi
