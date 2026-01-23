#!/bin/bash
# Blossom Execution Contracts - Sepolia Deployment Script
# This script deploys ExecutionRouter and MockSwapAdapter to Sepolia testnet

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Blossom Execution Contracts - Sepolia Deployment ===${NC}\n"

# Check for required environment variables
if [ -z "$SEPOLIA_RPC_URL" ]; then
    echo -e "${RED}ERROR: SEPOLIA_RPC_URL environment variable is not set${NC}"
    echo "Please set it with: export SEPOLIA_RPC_URL='https://sepolia.infura.io/v3/YOUR_INFURA_KEY'"
    exit 1
fi

if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: DEPLOYER_PRIVATE_KEY environment variable is not set${NC}"
    echo "Please set it with: export DEPLOYER_PRIVATE_KEY='0xYOUR_PRIVATE_KEY'"
    exit 1
fi

echo -e "${GREEN}✓ Environment variables set${NC}"
echo "  SEPOLIA_RPC_URL: ${SEPOLIA_RPC_URL:0:30}..."
echo "  DEPLOYER_PRIVATE_KEY: ${DEPLOYER_PRIVATE_KEY:0:10}...${DEPLOYER_PRIVATE_KEY: -4}"
echo ""

# Change to contracts directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$CONTRACTS_DIR"

echo -e "${YELLOW}Step 1: Installing OpenZeppelin contracts (if needed)...${NC}"
if [ ! -d "lib/openzeppelin-contracts" ]; then
    forge install openzeppelin/openzeppelin-contracts --no-commit
    echo -e "${GREEN}✓ OpenZeppelin contracts installed${NC}\n"
else
    echo -e "${GREEN}✓ OpenZeppelin contracts already installed${NC}\n"
fi

echo -e "${YELLOW}Step 2: Building contracts...${NC}"
forge build
echo -e "${GREEN}✓ Build successful${NC}\n"

echo -e "${YELLOW}Step 3: Running tests...${NC}"
forge test
echo -e "${GREEN}✓ All tests passed${NC}\n"

echo -e "${YELLOW}Step 4: Deploying to Sepolia testnet...${NC}"
echo "This may take a few minutes..."
echo ""

# Run deployment and capture output
DEPLOY_OUTPUT=$(forge script script/DeploySepolia.s.sol:DeploySepolia \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    -vvvv 2>&1)

# Check if deployment failed
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Deployment failed${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo "$DEPLOY_OUTPUT"
echo ""

# Extract addresses from output
# Look for lines like "ExecutionRouter deployed at: 0x..."
ROUTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "ExecutionRouter deployed at:" | sed -n 's/.*ExecutionRouter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "MockSwapAdapter deployed at:" | sed -n 's/.*MockSwapAdapter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
AAVE_ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "AaveV3SupplyAdapter deployed at:" | sed -n 's/.*AaveV3SupplyAdapter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)

# Also try to extract from the summary section
if [ -z "$ROUTER_ADDRESS" ]; then
    ROUTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "ExecutionRouter:" | sed -n 's/.*ExecutionRouter: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
fi
if [ -z "$ADAPTER_ADDRESS" ]; then
    ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "MockSwapAdapter:" | sed -n 's/.*MockSwapAdapter: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
fi

# Verify addresses were found
if [ -z "$ROUTER_ADDRESS" ] || [ -z "$ADAPTER_ADDRESS" ]; then
    echo -e "${YELLOW}WARNING: Could not automatically extract addresses from output${NC}"
    echo "Please manually find the addresses in the output above and add them to your config."
    echo ""
    echo "Look for lines containing:"
    echo "  - ExecutionRouter deployed at:"
    echo "  - MockSwapAdapter deployed at:"
    if [ -n "$AAVE_ADAPTER_ADDRESS" ]; then
        echo "  - AaveV3SupplyAdapter deployed at:"
    fi
    exit 0
fi

# Verify addresses are valid (start with 0x and are 42 chars)
if [[ ! "$ROUTER_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]] || [[ ! "$ADAPTER_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo -e "${YELLOW}WARNING: Extracted addresses may be invalid${NC}"
    echo "Router: $ROUTER_ADDRESS"
    echo "Adapter: $ADAPTER_ADDRESS"
    echo "Please verify these addresses manually."
    exit 0
fi

echo -e "${GREEN}=== Deployment Successful! ===${NC}\n"
echo -e "${GREEN}Copy these values to your backend config (agent/.env.local):${NC}\n"
echo "EXECUTION_ROUTER_ADDRESS=$ROUTER_ADDRESS"
echo "MOCK_SWAP_ADAPTER_ADDRESS=$ADAPTER_ADDRESS"
if [ -n "$AAVE_ADAPTER_ADDRESS" ]; then
    echo "AAVE_ADAPTER_ADDRESS=$AAVE_ADAPTER_ADDRESS"
    echo "AAVE_SEPOLIA_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"
    echo "LENDING_EXECUTION_MODE=real"
fi
echo ""

echo "EXECUTION_ROUTER_ADDRESS=$ROUTER_ADDRESS"
echo "MOCK_SWAP_ADAPTER_ADDRESS=$ADAPTER_ADDRESS"
echo "ETH_TESTNET_CHAIN_ID=11155111"
echo "ETH_TESTNET_RPC_URL=$SEPOLIA_RPC_URL"
echo ""

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy the addresses above to your backend .env file"
echo "2. See ETH_TESTNET_MVP_SETUP.md for complete configuration guide"
echo ""


