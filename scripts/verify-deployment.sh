#!/bin/bash
# Deployment Verification Script
# Verifies WETH adapter deployment and configuration

set -e

echo "=========================================="
echo "Blossom MVP - Deployment Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
WETH_ADAPTER_ADDRESS="0x43b98D6BA8C71d343b65Da1E438AcC7e11B95f87"
EXECUTION_ROUTER="0xC4F16fF20aC73F77A17c502ADCd80794c049ecb2"
SEPOLIA_RPC="https://sepolia.infura.io/v3/b9ea983becaf4298a2b7a47a3942c886"
API_URL="${API_URL:-https://api.blossom.onl}"

echo "Configuration:"
echo "  WETH Adapter: $WETH_ADAPTER_ADDRESS"
echo "  Router: $EXECUTION_ROUTER"
echo "  Network: Sepolia"
echo "  API: $API_URL"
echo ""

# Check 1: Verify contract exists on-chain
echo "1. Verifying WETH adapter contract on-chain..."
CODE=$(cast code $WETH_ADAPTER_ADDRESS --rpc-url $SEPOLIA_RPC 2>/dev/null || echo "0x")
if [ "$CODE" == "0x" ]; then
  echo -e "  ${RED}✗ Contract not found at address${NC}"
  exit 1
else
  echo -e "  ${GREEN}✓ Contract deployed and verified${NC}"
fi

# Check 2: Verify WETH address in adapter
echo "2. Checking WETH address configuration..."
WETH_IN_ADAPTER=$(cast call $WETH_ADAPTER_ADDRESS "weth()(address)" --rpc-url $SEPOLIA_RPC 2>/dev/null || echo "error")
if [ "$WETH_IN_ADAPTER" == "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9" ]; then
  echo -e "  ${GREEN}✓ WETH address correct: $WETH_IN_ADAPTER${NC}"
else
  echo -e "  ${RED}✗ WETH address mismatch: $WETH_IN_ADAPTER${NC}"
  exit 1
fi

# Check 3: Verify adapter in router allowlist
echo "3. Checking router allowlist..."
IS_ALLOWED=$(cast call $EXECUTION_ROUTER "isAdapterAllowed(address)(bool)" $WETH_ADAPTER_ADDRESS --rpc-url $SEPOLIA_RPC 2>/dev/null || echo "error")
if [ "$IS_ALLOWED" == "true" ]; then
  echo -e "  ${GREEN}✓ Adapter is in router allowlist${NC}"
else
  echo -e "  ${RED}✗ Adapter not in allowlist: $IS_ALLOWED${NC}"
  exit 1
fi

# Check 4: Verify backend configuration
echo "4. Checking backend configuration..."
if [ -f "agent/.env.local" ]; then
  ENV_ADAPTER=$(grep "WETH_WRAP_ADAPTER_ADDRESS" agent/.env.local | cut -d'=' -f2)
  if [ "$ENV_ADAPTER" == "$WETH_ADAPTER_ADDRESS" ]; then
    echo -e "  ${GREEN}✓ Backend environment configured correctly${NC}"
  else
    echo -e "  ${YELLOW}⚠ Backend env mismatch: $ENV_ADAPTER${NC}"
  fi
else
  echo -e "  ${YELLOW}⚠ agent/.env.local not found (might be on production)${NC}"
fi

# Check 5: Verify backend API (if accessible)
echo "5. Checking backend API..."
if command -v curl &> /dev/null; then
  HEALTH=$(curl -s "$API_URL/api/health" 2>/dev/null || echo "error")
  if [[ "$HEALTH" == *"ok"* ]] || [[ "$HEALTH" == *"healthy"* ]]; then
    echo -e "  ${GREEN}✓ Backend API is healthy${NC}"

    # Check preflight endpoint
    PREFLIGHT=$(curl -s "$API_URL/api/execute/preflight" 2>/dev/null || echo "error")
    if [[ "$PREFLIGHT" == *"$WETH_ADAPTER_ADDRESS"* ]]; then
      echo -e "  ${GREEN}✓ WETH adapter in API allowlist${NC}"
    else
      echo -e "  ${YELLOW}⚠ WETH adapter not in API response (may need backend restart)${NC}"
    fi
  else
    echo -e "  ${YELLOW}⚠ Backend API not accessible: $API_URL${NC}"
  fi
else
  echo -e "  ${YELLOW}⚠ curl not available, skipping API check${NC}"
fi

# Check 6: Verify frontend builds
echo "6. Verifying frontend build..."
if [ -d "dist" ] && [ -f "dist/index.html" ]; then
  echo -e "  ${GREEN}✓ Frontend build artifacts present${NC}"
else
  echo -e "  ${YELLOW}⚠ Frontend dist/ not found (run npm run build)${NC}"
fi

# Check 7: Verify backend builds
echo "7. Verifying backend build..."
if [ -d "agent/dist" ] && [ -f "agent/dist/src/server/http.js" ]; then
  echo -e "  ${GREEN}✓ Backend build artifacts present${NC}"
else
  echo -e "  ${YELLOW}⚠ Backend dist/ not found (run npm run build in agent/)${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✓ Deployment verification complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Manual test: Swap 0.01 ETH to REDACTED"
echo "2. Manual test: DeFi deposit (check 2s position sync)"
echo "3. Deploy to production"
echo "4. Monitor API logs for 30 minutes"
echo ""
echo "View on Etherscan:"
echo "https://sepolia.etherscan.io/address/$WETH_ADAPTER_ADDRESS"
echo ""
