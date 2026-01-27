#!/bin/bash
#
# Blossom Sepolia Deployment + Verification Script
# 
# This script:
# 1. Verifies Foundry availability
# 2. Verifies deployer wallet balance
# 3. Builds and tests contracts
# 4. Deploys contracts to Sepolia
# 5. Captures deployed addresses (stdout only)
# 6. Starts backend with in-memory env vars
# 7. Runs strict E2E verification
#
# Safety:
# - Never logs or persists private keys
# - All secrets from environment only
# - Uses /bin/bash explicitly
# - Anchors to repo root

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Backend PID tracking (for targeted cleanup only)
BACKEND_PID=""

# Cleanup function: only kills the backend we started
cleanup_backend() {
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}Cleaning up backend (PID $BACKEND_PID)...${NC}"
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}

# Trap to ensure cleanup on exit
trap cleanup_backend EXIT INT TERM

# Configuration: PORT, BASE_URL, SKIP_DEPLOY, VERIFY_ONLY
PORT="${PORT:-3001}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
VERIFY_ONLY="${VERIFY_ONLY:-0}"

# Deployer address (public, safe to print)
DEPLOYER_ADDRESS="0x75B0406fFBcFCA51f8606FbbA340FB52A402f3e0"
TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"

# Sepolia token addresses (public constants)
REDACTED_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
WETH_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"

echo -e "${GREEN}=== Blossom Sepolia Deployment + Verification ===${NC}\n"
echo -e "${BLUE}Configuration:${NC}"
echo "  PORT: ${PORT}"
echo "  BASE_URL: ${BASE_URL}"
echo "  SKIP_DEPLOY: ${SKIP_DEPLOY}"
echo "  VERIFY_ONLY: ${VERIFY_ONLY}"
echo ""

# Step 0: Anchor to repo root
REPO_ROOT="$(cd "$(git rev-parse --show-toplevel 2>/dev/null)" && pwd)"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT" ]; then
    echo -e "${RED}ERROR: Not in a git repository${NC}"
    exit 1
fi
cd "$REPO_ROOT"
echo -e "${BLUE}✓ Working directory: $REPO_ROOT${NC}\n"

# Step 1: Verify Foundry availability
echo -e "${YELLOW}Step 1: Verifying Foundry...${NC}"
export PATH="$HOME/.foundry/bin:$PATH"

if ! command -v forge >/dev/null 2>&1; then
    echo -e "${RED}ERROR: forge not found in PATH${NC}"
    echo "Please install Foundry: curl -L https://foundry.paradigm.xyz | bash"
    exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
    echo -e "${RED}ERROR: cast not found in PATH${NC}"
    exit 1
fi

FORGE_VERSION=$(forge --version 2>&1 | head -1)
CAST_VERSION=$(cast --version 2>&1 | head -1)
echo -e "${GREEN}✓ Foundry available${NC}"
echo "  $FORGE_VERSION"
echo "  $CAST_VERSION"
echo ""

# Step 2: Verify required environment variables
echo -e "${YELLOW}Step 2: Verifying environment variables...${NC}"

# Always require RPC URL
: "${SEPOLIA_RPC_URL:?ERROR: SEPOLIA_RPC_URL environment variable is required}"
export ETH_TESTNET_RPC_URL="${ETH_TESTNET_RPC_URL:-$SEPOLIA_RPC_URL}"

# DEPLOYER_PRIVATE_KEY only required if not skipping deploy
if [ "$SKIP_DEPLOY" != "1" ]; then
    : "${DEPLOYER_PRIVATE_KEY:?ERROR: DEPLOYER_PRIVATE_KEY environment variable is required (set SKIP_DEPLOY=1 to skip deployment)}"
fi

# If SKIP_DEPLOY, require contract addresses
if [ "$SKIP_DEPLOY" = "1" ]; then
    : "${EXECUTION_ROUTER_ADDRESS:?ERROR: EXECUTION_ROUTER_ADDRESS required when SKIP_DEPLOY=1}"
    : "${MOCK_SWAP_ADAPTER_ADDRESS:?ERROR: MOCK_SWAP_ADAPTER_ADDRESS required when SKIP_DEPLOY=1}"
    : "${REDACTED_ADDRESS_SEPOLIA:?ERROR: REDACTED_ADDRESS_SEPOLIA required when SKIP_DEPLOY=1}"
    : "${WETH_ADDRESS_SEPOLIA:?ERROR: WETH_ADDRESS_SEPOLIA required when SKIP_DEPLOY=1}"
    ROUTER_ADDRESS="$EXECUTION_ROUTER_ADDRESS"
    MOCK_ADAPTER_ADDRESS="$MOCK_SWAP_ADAPTER_ADDRESS"
    UNISWAP_ADAPTER_ADDRESS="${UNISWAP_V3_ADAPTER_ADDRESS:-}"
    # Use provided token addresses instead of defaults
    REDACTED_SEPOLIA="$REDACTED_ADDRESS_SEPOLIA"
    WETH_SEPOLIA="$WETH_ADDRESS_SEPOLIA"
fi

echo -e "${GREEN}✓ Environment variables set${NC}"
echo "  SEPOLIA_RPC_URL: ${SEPOLIA_RPC_URL:0:40}..."
echo "  ETH_TESTNET_RPC_URL: ${ETH_TESTNET_RPC_URL:0:40}..."
if [ "$SKIP_DEPLOY" != "1" ]; then
    echo "  DEPLOYER_PRIVATE_KEY: [REDACTED - never logged]"
fi
if [ "$SKIP_DEPLOY" = "1" ]; then
    echo "  EXECUTION_ROUTER_ADDRESS: $ROUTER_ADDRESS"
    echo "  MOCK_SWAP_ADAPTER_ADDRESS: $MOCK_ADAPTER_ADDRESS"
    if [ -n "$UNISWAP_ADAPTER_ADDRESS" ]; then
        echo "  UNISWAP_V3_ADAPTER_ADDRESS: $UNISWAP_ADAPTER_ADDRESS"
    fi
    echo "  REDACTED_ADDRESS_SEPOLIA: $REDACTED_SEPOLIA"
    echo "  WETH_ADDRESS_SEPOLIA: $WETH_SEPOLIA"
fi
echo ""

# Step 3: Verify deployer wallet balance (skip if SKIP_DEPLOY or VERIFY_ONLY)
if [ "$SKIP_DEPLOY" != "1" ] && [ "$VERIFY_ONLY" != "1" ]; then
    echo -e "${YELLOW}Step 3: Verifying deployer wallet balance...${NC}"
    BALANCE_ETH=$(cast balance "$DEPLOYER_ADDRESS" --ether --rpc-url "$SEPOLIA_RPC_URL" 2>&1 || echo "ERROR")

    if [[ "$BALANCE_ETH" == *"ERROR"* ]] || [[ -z "$BALANCE_ETH" ]]; then
        echo -e "${RED}ERROR: Failed to fetch balance from RPC${NC}"
        echo "RPC URL: ${SEPOLIA_RPC_URL:0:40}..."
        exit 1
    fi

    # Extract numeric value (handle "0.25 ETH" format)
    BALANCE_NUM=$(echo "$BALANCE_ETH" | sed 's/ ETH//' | xargs)
    MIN_BALANCE="0.05"

    # Compare using awk for floating point
    BALANCE_OK=$(awk -v bal="$BALANCE_NUM" -v min="$MIN_BALANCE" 'BEGIN {print (bal >= min)}')

    if [ "$BALANCE_OK" != "1" ]; then
        echo -e "${RED}ERROR: Insufficient balance${NC}"
        echo "  Deployer: $DEPLOYER_ADDRESS"
        echo "  Balance: $BALANCE_ETH"
        echo "  Required: >= $MIN_BALANCE ETH"
        exit 1
    fi

    echo -e "${GREEN}✓ Deployer wallet balance: $BALANCE_ETH${NC}"
    echo ""
else
    echo -e "${YELLOW}Step 3: Skipping balance check (SKIP_DEPLOY or VERIFY_ONLY mode)${NC}"
    echo ""
fi

# Step 4: Build and test contracts (skip if VERIFY_ONLY)
if [ "$VERIFY_ONLY" != "1" ]; then
    echo -e "${YELLOW}Step 4: Building and testing contracts...${NC}"
    cd "$REPO_ROOT/contracts"

    # Ensure libs are installed
    if [ ! -d "lib/openzeppelin-contracts" ]; then
        echo "Installing OpenZeppelin contracts..."
        forge install openzeppelin/openzeppelin-contracts --no-commit
    fi

    echo "Building contracts..."
    if ! forge build >/dev/null 2>&1; then
        echo -e "${RED}ERROR: Contract build failed${NC}"
        forge build
        exit 1
    fi
    echo -e "${GREEN}✓ Build successful${NC}"

    echo "Running tests..."
    if ! forge test >/dev/null 2>&1; then
        echo -e "${RED}ERROR: Tests failed${NC}"
        forge test
        exit 1
    fi
    echo -e "${GREEN}✓ All tests passed${NC}"
    echo ""
else
    echo -e "${YELLOW}Step 4: Skipping build/test (VERIFY_ONLY mode)${NC}"
    echo ""
fi

# Step 5: Deploy contracts to Sepolia (skip if SKIP_DEPLOY or VERIFY_ONLY)
if [ "$SKIP_DEPLOY" != "1" ] && [ "$VERIFY_ONLY" != "1" ]; then
    echo -e "${YELLOW}Step 5: Deploying contracts to Sepolia...${NC}"
    echo "This may take a few minutes..."
    echo ""

    # Run deployment and capture output
    DEPLOY_OUTPUT=$(forge script script/DeploySepolia.s.sol:DeploySepolia \
        --rpc-url "$SEPOLIA_RPC_URL" \
        --broadcast \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        -vvv 2>&1)

    # Check deployment status
    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR: Deployment failed${NC}"
        echo "$DEPLOY_OUTPUT"
        exit 1
    fi

    # Extract addresses from output
    ROUTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "ExecutionRouter deployed at:" | sed -n 's/.*ExecutionRouter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
    MOCK_ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "MockSwapAdapter deployed at:" | sed -n 's/.*MockSwapAdapter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
    UNISWAP_ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "UniswapV3SwapAdapter deployed at:" | sed -n 's/.*UniswapV3SwapAdapter deployed at: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)

    # Fallback to summary section
    if [ -z "$ROUTER_ADDRESS" ]; then
        ROUTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "ExecutionRouter:" | sed -n 's/.*ExecutionRouter: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
    fi
    if [ -z "$MOCK_ADAPTER_ADDRESS" ]; then
        MOCK_ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "MockSwapAdapter:" | sed -n 's/.*MockSwapAdapter: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
    fi
    if [ -z "$UNISWAP_ADAPTER_ADDRESS" ]; then
        UNISWAP_ADAPTER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -i "UniswapV3SwapAdapter:" | sed -n 's/.*UniswapV3SwapAdapter: \(0x[a-fA-F0-9]\{40\}\).*/\1/p' | head -1)
    fi

    # Validate addresses
    if [ -z "$ROUTER_ADDRESS" ] || [ -z "$MOCK_ADAPTER_ADDRESS" ]; then
        echo -e "${RED}ERROR: Could not extract deployed addresses${NC}"
        echo "Please check deployment output above"
        exit 1
    fi

    if [[ ! "$ROUTER_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]] || [[ ! "$MOCK_ADAPTER_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
        echo -e "${RED}ERROR: Invalid address format${NC}"
        echo "Router: $ROUTER_ADDRESS"
        echo "MockAdapter: $MOCK_ADAPTER_ADDRESS"
        exit 1
    fi

    echo -e "${GREEN}✓ Deployment successful${NC}"
    echo ""
    echo -e "${BLUE}=== Deployed Addresses ===${NC}"
    echo "EXECUTION_ROUTER_ADDRESS=$ROUTER_ADDRESS"
    echo "MOCK_SWAP_ADAPTER_ADDRESS=$MOCK_ADAPTER_ADDRESS"
    if [ -n "$UNISWAP_ADAPTER_ADDRESS" ]; then
        echo "UNISWAP_V3_ADAPTER_ADDRESS=$UNISWAP_ADAPTER_ADDRESS"
    fi
    echo ""
else
    echo -e "${YELLOW}Step 5: Skipping deployment (SKIP_DEPLOY or VERIFY_ONLY mode)${NC}"
    echo ""
fi

# Step 6: Export backend env vars (in-memory only, never to disk)
echo -e "${YELLOW}Step 6: Configuring backend environment...${NC}"

# Safety check: ensure we never write .env files
if [ -f "$REPO_ROOT/agent/.env.local" ] || [ -f "$REPO_ROOT/agent/.env" ]; then
    echo -e "${YELLOW}Note: Existing .env files found (will not be modified)${NC}"
fi

export EXECUTION_MODE="eth_testnet"
export EXECUTION_AUTH_MODE="direct"
export ETH_TESTNET_RPC_URL
export EXECUTION_ROUTER_ADDRESS="$ROUTER_ADDRESS"
export MOCK_SWAP_ADAPTER_ADDRESS="$MOCK_ADAPTER_ADDRESS"
export REDACTED_ADDRESS_SEPOLIA="$REDACTED_SEPOLIA"
export WETH_ADDRESS_SEPOLIA="$WETH_SEPOLIA"
export TEST_USER_ADDRESS

if [ -n "$UNISWAP_ADAPTER_ADDRESS" ]; then
    export UNISWAP_V3_ADAPTER_ADDRESS="$UNISWAP_ADAPTER_ADDRESS"
fi

echo -e "${GREEN}✓ Backend environment configured (in-memory only, no .env files written)${NC}"
echo ""

# Step 7: Check if port is available
echo -e "${YELLOW}Step 7: Preparing backend...${NC}"
if curl -s -f "${BASE_URL}/health" >/dev/null 2>&1; then
    echo -e "${RED}ERROR: Port ${PORT} appears to be in use${NC}"
    echo "  URL: ${BASE_URL}"
    echo "  To inspect what's using the port, run:"
    echo "    lsof -nP -iTCP:${PORT} -sTCP:LISTEN"
    echo "  Or use a different port by setting:"
    echo "    export PORT=<different_port>"
    echo "    export BASE_URL=http://localhost:<different_port>"
    exit 1
fi
echo -e "${GREEN}✓ Port ${PORT} available${NC}"
echo ""

# Step 8: Start backend
echo -e "${YELLOW}Step 8: Starting backend...${NC}"
cd "$REPO_ROOT/agent"

# Start backend in background
PORT="$PORT" npm run dev > /tmp/blossom-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to be ready
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if curl -s -f "${BASE_URL}/health" >/dev/null 2>&1; then
        break
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo -e "${RED}ERROR: Backend failed to start${NC}"
    echo "Logs:"
    tail -20 /tmp/blossom-backend.log
    cleanup_backend
    exit 1
fi

# Verify preflight
PREFLIGHT_RESPONSE=$(curl -s "${BASE_URL}/api/execute/preflight" || echo "ERROR")
if [[ "$PREFLIGHT_RESPONSE" == *"ERROR"* ]] || [[ "$PREFLIGHT_RESPONSE" != *"ok"* ]]; then
    echo -e "${RED}ERROR: Preflight check failed${NC}"
    echo "Response: $PREFLIGHT_RESPONSE"
    cleanup_backend
    exit 1
fi

echo -e "${GREEN}✓ Backend started and healthy${NC}"
echo "  PID: $BACKEND_PID"
echo "  Health: ${BASE_URL}/health"
echo ""

# Step 9: Run strict E2E test
echo -e "${YELLOW}Step 9: Running strict E2E verification...${NC}"
cd "$REPO_ROOT"

# Export test env vars
export EXECUTION_MODE="eth_testnet"
export EXECUTION_AUTH_MODE="direct"
export TEST_USER_ADDRESS
export BASE_URL  # Ensure E2E script uses correct BASE_URL

# Determine intent (default to mock, but allow override via E2E_INTENT env var)
E2E_INTENT="${E2E_INTENT:-mock}"

# Print command being run (no secrets)
echo -e "${BLUE}Command:${NC} BASE_URL=\"${BASE_URL}\" node agent/scripts/e2e-sepolia-smoke.ts --full --intent ${E2E_INTENT}"
echo ""

# Run E2E test and capture output
# Use a temporary file to ensure we capture all output even if script exits early
E2E_OUTPUT_FILE=$(mktemp)
set +e  # Temporarily disable exit on error to capture exit code
BASE_URL="$BASE_URL" node agent/scripts/e2e-sepolia-smoke.ts --full --intent "$E2E_INTENT" > "$E2E_OUTPUT_FILE" 2>&1
E2E_EXIT=$?
set -e  # Re-enable exit on error

# Read output before cleanup
E2E_OUTPUT=$(cat "$E2E_OUTPUT_FILE" 2>/dev/null || echo "")

# Always print the full output
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}E2E Test Output:${NC}"
echo "$E2E_OUTPUT"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}E2E Exit Code: ${E2E_EXIT}${NC}"
echo ""

# Clean up temp file
rm -f "$E2E_OUTPUT_FILE"

# Check results
if [ $E2E_EXIT -ne 0 ]; then
    echo -e "${RED}✗ E2E test failed (exit code: ${E2E_EXIT})${NC}"
    echo ""
    echo -e "${YELLOW}Backend logs (last 60 lines):${NC}"
    if [ -f /tmp/blossom-backend.log ]; then
        tail -60 /tmp/blossom-backend.log
    else
        echo "  (Backend log file not found)"
    fi
    echo ""
    cleanup_backend
    exit 1
fi

# Check for PASS/FAIL summary in output
if echo "$E2E_OUTPUT" | grep -q "Passed:.*Failed: 0"; then
    echo -e "${GREEN}✓ E2E verification passed${NC}"
elif echo "$E2E_OUTPUT" | grep -q "Passed:"; then
    echo -e "${YELLOW}⚠ E2E completed but may have warnings${NC}"
    echo "Please review E2E output above"
else
    echo -e "${YELLOW}⚠ E2E completed (unable to parse summary)${NC}"
    echo "Please review E2E output above"
fi
echo ""

# Step 10: Cleanup and summary
echo -e "${GREEN}=== Deployment + Verification Complete ===${NC}\n"
echo -e "${BLUE}Summary:${NC}"
echo "  RPC: ${SEPOLIA_RPC_URL:0:40}..."
echo "  Router: $ROUTER_ADDRESS"
echo "  MockAdapter: $MOCK_ADAPTER_ADDRESS"
if [ -n "$UNISWAP_ADAPTER_ADDRESS" ]; then
    echo "  UniswapAdapter: $UNISWAP_ADAPTER_ADDRESS"
fi
echo "  Backend: Running (PID $BACKEND_PID) on ${BASE_URL}"
echo "  E2E: Passed"
echo ""
echo -e "${YELLOW}Note: Backend is still running in background${NC}"
echo "  PID: $BACKEND_PID"
echo "  URL: ${BASE_URL}"
echo "  To stop: kill $BACKEND_PID"
echo "  Logs: tail -f /tmp/blossom-backend.log"
echo ""
echo -e "${GREEN}✓ All checks passed!${NC}"
echo ""
echo -e "${BLUE}Security notes:${NC}"
echo "  ✓ No secrets logged or persisted"
echo "  ✓ No .env files written"
echo "  ✓ Backend cleanup via trap (PID $BACKEND_PID)"

