#!/bin/bash
# ETH Testnet Smoke Test Script
# Guides operator through deployment and verification

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Blossom ETH Testnet Smoke Test ===${NC}\n"

# Step 1: Check environment variables
echo -e "${YELLOW}Step 1: Checking environment variables...${NC}"

MISSING_VARS=()

if [ -z "$SEPOLIA_RPC_URL" ]; then
  MISSING_VARS+=("SEPOLIA_RPC_URL")
fi

if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
  MISSING_VARS+=("DEPLOYER_PRIVATE_KEY")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo -e "${RED}❌ Missing required environment variables:${NC}"
  for var in "${MISSING_VARS[@]}"; do
    echo "  - $var"
  done
  echo ""
  echo "Please set them:"
  echo "  export SEPOLIA_RPC_URL='https://sepolia.infura.io/v3/YOUR_KEY'"
  echo "  export DEPLOYER_PRIVATE_KEY='0xYOUR_KEY'"
  exit 1
fi

echo -e "${GREEN}✓ Environment variables set${NC}\n"

# Step 2: Deploy contracts
echo -e "${YELLOW}Step 2: Deploying contracts to Sepolia...${NC}"
echo "This will deploy ExecutionRouter and MockSwapAdapter."
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Skipping deployment. Make sure contracts are already deployed."
else
  cd contracts
  ./scripts/deploy-sepolia.sh
  cd ..
  
  echo ""
  echo -e "${YELLOW}Please copy the deployed addresses from above and set them:${NC}"
  echo "  export EXECUTION_ROUTER_ADDRESS='0x...'"
  echo "  export MOCK_SWAP_ADAPTER_ADDRESS='0x...'"
  echo "  export ETH_TESTNET_RPC_URL='$SEPOLIA_RPC_URL'"
  echo ""
  read -p "Press Enter after setting the addresses..."
fi

# Step 3: Check backend config
echo -e "${YELLOW}Step 3: Checking backend configuration...${NC}"

if [ -z "$EXECUTION_ROUTER_ADDRESS" ]; then
  echo -e "${RED}❌ EXECUTION_ROUTER_ADDRESS not set${NC}"
  echo "Set it with: export EXECUTION_ROUTER_ADDRESS='0x...'"
  exit 1
fi

if [ -z "$MOCK_SWAP_ADAPTER_ADDRESS" ]; then
  echo -e "${RED}❌ MOCK_SWAP_ADAPTER_ADDRESS not set${NC}"
  echo "Set it with: export MOCK_SWAP_ADAPTER_ADDRESS='0x...'"
  exit 1
fi

if [ -z "$ETH_TESTNET_RPC_URL" ]; then
  echo -e "${RED}❌ ETH_TESTNET_RPC_URL not set${NC}"
  echo "Set it with: export ETH_TESTNET_RPC_URL='$SEPOLIA_RPC_URL'"
  exit 1
fi

echo -e "${GREEN}✓ Backend configuration present${NC}\n"

# Step 4: Check if backend is running
echo -e "${YELLOW}Step 4: Checking backend server...${NC}"

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s -f "$BACKEND_URL/api/execute/preflight" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend server is running${NC}\n"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "Backend not responding, retrying... ($RETRY_COUNT/$MAX_RETRIES)"
      sleep 2
    else
      echo -e "${RED}❌ Backend server is not running${NC}"
      echo "Please start the backend:"
      echo "  cd agent && npm run dev"
      echo ""
      echo "Or set BACKEND_URL if it's running on a different port:"
      echo "  export BACKEND_URL='http://localhost:PORT'"
      exit 1
    fi
  fi
done

# Step 5: Run preflight check
echo -e "${YELLOW}Step 5: Running preflight check...${NC}"

PREFLIGHT_RESPONSE=$(curl -s "$BACKEND_URL/api/execute/preflight" || echo "")

if [ -z "$PREFLIGHT_RESPONSE" ]; then
  echo -e "${RED}❌ Failed to get preflight response${NC}"
  exit 1
fi

# Parse and display results
echo ""
echo "$PREFLIGHT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$PREFLIGHT_RESPONSE"
echo ""

# Check if preflight passed
PREFLIGHT_OK=$(echo "$PREFLIGHT_RESPONSE" | grep -o '"ok":[^,]*' | cut -d: -f2 | tr -d ' ')

if [ "$PREFLIGHT_OK" = "true" ]; then
  echo -e "${GREEN}=== ✅ System is ready for ETH testnet execution! ===${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Set frontend mode: export VITE_EXECUTION_MODE=eth_testnet"
  echo "  2. Start frontend: npm run dev"
  echo "  3. Connect wallet and test execution"
else
  echo -e "${RED}=== ❌ Preflight check failed ===${NC}"
  echo ""
  echo "Please review the errors above and fix them before proceeding."
  exit 1
fi


