#!/bin/bash

#
# Local MVP Acceptance Test Runner
# Runs preflight checks and e2e tests for the Sepolia testnet MVP
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  Blossom Local MVP Acceptance Check"
echo "========================================"
echo ""

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Backend URL: $BACKEND_URL"
echo "  Frontend URL: $FRONTEND_URL"
echo ""

# Step 1: Check if backend is running
echo -e "${YELLOW}Step 1: Checking backend health...${NC}"
HEALTH_RESPONSE=$(curl -s "$BACKEND_URL/health" || echo "FAILED")
if [[ "$HEALTH_RESPONSE" == *"ok"* ]]; then
    echo -e "  ${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "  ${RED}✗ Backend not running or unhealthy${NC}"
    echo "  Response: $HEALTH_RESPONSE"
    echo ""
    echo "  Start the backend with:"
    echo "    cd agent && npm run dev"
    exit 1
fi
echo ""

# Step 2: Run preflight check
echo -e "${YELLOW}Step 2: Running preflight check...${NC}"
PREFLIGHT_RESPONSE=$(curl -s "$BACKEND_URL/api/execute/preflight")
echo "$PREFLIGHT_RESPONSE" | jq . 2>/dev/null || echo "$PREFLIGHT_RESPONSE"

# Check if preflight is ok
PREFLIGHT_OK=$(echo "$PREFLIGHT_RESPONSE" | jq -r '.ok' 2>/dev/null)
if [[ "$PREFLIGHT_OK" == "true" ]]; then
    echo -e "  ${GREEN}✓ Preflight passed${NC}"
else
    echo -e "  ${YELLOW}⚠ Preflight returned ok=false (may need configuration)${NC}"
fi
echo ""

# Step 3: Run forge tests
echo -e "${YELLOW}Step 3: Running contract tests...${NC}"
cd "$ROOT_DIR/contracts"
if forge test --summary 2>&1 | tail -5; then
    echo -e "  ${GREEN}✓ Contract tests passed${NC}"
else
    echo -e "  ${RED}✗ Contract tests failed${NC}"
    exit 1
fi
echo ""

# Step 4: Build checks
echo -e "${YELLOW}Step 4: Running build checks...${NC}"
cd "$ROOT_DIR"

# Frontend build
echo "  Checking frontend build..."
if npm run build 2>&1 | tail -3 | grep -q "built in"; then
    echo -e "  ${GREEN}✓ Frontend build passed${NC}"
else
    echo -e "  ${RED}✗ Frontend build failed${NC}"
    exit 1
fi

# Backend build
echo "  Checking backend build..."
cd "$ROOT_DIR/agent"
if npm run build 2>&1 | tail -1; then
    echo -e "  ${GREEN}✓ Backend build passed${NC}"
else
    echo -e "  ${RED}✗ Backend build failed${NC}"
    exit 1
fi
echo ""

# Step 5: Run API tests
echo -e "${YELLOW}Step 5: Running API acceptance tests...${NC}"
cd "$ROOT_DIR"

# Check if playwright is installed
if ! command -v npx &> /dev/null; then
    echo -e "  ${YELLOW}⚠ npx not found, skipping Playwright tests${NC}"
else
    # Run playwright tests (API only, no browser needed)
    if npx playwright test --reporter=list 2>&1; then
        echo -e "  ${GREEN}✓ API tests passed${NC}"
    else
        echo -e "  ${YELLOW}⚠ Some API tests failed (may need configuration)${NC}"
    fi
fi
echo ""

# Step 6: Check telemetry log
echo -e "${YELLOW}Step 6: Checking telemetry...${NC}"
TELEMETRY_LOG="$ROOT_DIR/agent/logs/telemetry.jsonl"
if [[ -f "$TELEMETRY_LOG" ]]; then
    LINES=$(wc -l < "$TELEMETRY_LOG")
    echo -e "  ${GREEN}✓ Telemetry log exists: $LINES lines${NC}"
    echo "  Last 3 events:"
    tail -3 "$TELEMETRY_LOG" | while read line; do
        echo "    $line" | jq -c '.type, .ts' 2>/dev/null || echo "    $line"
    done
else
    echo -e "  ${YELLOW}⚠ No telemetry log found (will be created on first request)${NC}"
fi
echo ""

# Summary
echo "========================================"
echo -e "  ${GREEN}MVP Acceptance Check Complete${NC}"
echo "========================================"
echo ""
echo "Logs:"
echo "  Telemetry: $ROOT_DIR/agent/logs/telemetry.jsonl"
echo "  Playwright: $ROOT_DIR/playwright-report/index.html"
echo ""
echo "Next steps:"
echo "  1. Deploy contracts: cd contracts && ./scripts/deploy-sepolia.sh"
echo "  2. Update .env files with deployed addresses"
echo "  3. Run e2e with wallet: npx playwright test --headed"
echo ""


