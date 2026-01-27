#!/bin/bash

#
# Restart Demo Script
# Kills processes on ports 3001 and 5173, then starts backend + frontend
# Ensures dependencies are available and verifies health before completion
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔄 Restarting Blossom Demo..."
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found"
  echo ""
  echo "Please install Node.js (v18+):"
  echo "  https://nodejs.org/"
  exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
  echo "❌ npm not found"
  echo ""
  echo "Please install npm (comes with Node.js)"
  exit 1
fi

# Check node_modules exists
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "❌ Dependencies not installed"
  echo ""
  echo "Please run:"
  echo "  npm install"
  echo ""
  echo "Or install all dependencies:"
  echo "  npm run install:all"
  exit 1
fi

# Check agent/node_modules exists
if [ ! -d "$ROOT_DIR/agent/node_modules" ]; then
  echo "⚠️  Agent dependencies not installed"
  echo ""
  echo "Please run:"
  echo "  npm run install:all"
  exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Kill processes on ports 3001 and 5173 (mac-friendly)
echo "Stopping existing processes..."

# Backend (port 3001)
if lsof -ti :3001 > /dev/null 2>&1; then
  echo "  Killing process on port 3001..."
  lsof -ti :3001 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Frontend (port 5173)
if lsof -ti :5173 > /dev/null 2>&1; then
  echo "  Killing process on port 5173..."
  lsof -ti :5173 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "✅ Ports cleared"
echo ""

# Clear stale logs
echo "Clearing stale logs..."
if [ -d "$ROOT_DIR/logs" ]; then
  find "$ROOT_DIR/logs" -name "*.log" -type f -mtime +1 -delete 2>/dev/null || true
  echo "  Cleared old log files"
fi
if [ -d "$ROOT_DIR/agent/logs" ]; then
  find "$ROOT_DIR/agent/logs" -name "*.jsonl" -type f -mtime +1 -delete 2>/dev/null || true
  echo "  Cleared old telemetry logs"
fi
echo ""

# Start backend + frontend
echo "Starting backend + frontend..."
echo ""

cd "$ROOT_DIR"

# Run dev:demo (will start both services in background)
echo "Starting services via npm run dev:demo..."
npm run dev:demo > /tmp/blossom-demo.log 2>&1 &
DEMO_PID=$!

# Wait for services to start with health check loop
echo "Waiting for services to start..."
echo ""

MAX_WAIT=20
WAIT_INTERVAL=1
ELAPSED=0
HEALTH_OK=false
VITE_BOUND=false

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Check backend health
  HEALTH_RESPONSE=$(curl -s --max-time 2 http://127.0.0.1:3001/health 2>/dev/null || echo "")
  
  if [[ "$HEALTH_RESPONSE" == *"ok"* ]]; then
    HEALTH_OK=true
  fi
  
  # Check Vite is bound to 5173 (not 5174)
  if lsof -ti :5173 > /dev/null 2>&1; then
    # Verify it's bound to 0.0.0.0 or 127.0.0.1, not [::1]
    VITE_BINDING=$(lsof -nP -iTCP:5173 -sTCP:LISTEN 2>/dev/null | grep -v "^COMMAND" | head -1 || echo "")
    if echo "$VITE_BINDING" | grep -q "0.0.0.0:5173\|127.0.0.1:5173" 2>/dev/null; then
      VITE_BOUND=true
    fi
  fi
  
  if [ "$HEALTH_OK" = true ] && [ "$VITE_BOUND" = true ]; then
    break
  fi
  
  echo -n "."
  sleep $WAIT_INTERVAL
  ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

echo ""
echo ""

# Verify Vite binding
if [ "$VITE_BOUND" = false ]; then
  echo "⚠️  WARNING: Vite may not be bound correctly to port 5173"
  echo "   Checking binding..."
  VITE_BINDING=$(lsof -nP -iTCP:5173 -sTCP:LISTEN 2>/dev/null || echo "")
  if [ -z "$VITE_BINDING" ]; then
    echo "   ❌ No process found on port 5173"
    echo "   Check /tmp/blossom-demo.log for Vite errors"
  else
    echo "   Current binding:"
    echo "$VITE_BINDING" | head -3
    if echo "$VITE_BINDING" | grep -q "\[::1\]:5173" 2>/dev/null; then
      echo "   ❌ Vite is bound to [::1]:5173 (IPv6 only) - should be 0.0.0.0:5173"
    fi
  fi
  echo ""
fi

# Post-start verification
echo "=========================================="
echo "Post-start verification..."
echo "=========================================="
echo ""

if [ "$HEALTH_OK" = true ]; then
  echo "✅ Backend health check passed"
  echo ""
  
  # Check execution mode
  EXECUTION_MODE=$(echo "$HEALTH_RESPONSE" | grep -o '"executionMode":"[^"]*"' | cut -d'"' -f4 || echo "")
  if [ "$EXECUTION_MODE" != "eth_testnet" ]; then
    echo "⚠️  WARNING: executionMode is '$EXECUTION_MODE' (expected: eth_testnet for V1/V1.1)"
    echo ""
  fi
  
  # Check for missing config
  if echo "$HEALTH_RESPONSE" | grep -q '"missing"' 2>/dev/null; then
    echo "⚠️  WARNING: Missing required configuration detected"
    echo "   Check /health response for details"
    echo ""
  fi
  
  # Run preflight check
  echo "Running preflight check..."
  PREFLIGHT_RESPONSE=$(curl -s --max-time 5 http://127.0.0.1:3001/api/execute/preflight 2>/dev/null || echo "")
  
  if echo "$PREFLIGHT_RESPONSE" | grep -q '"ok":true' 2>/dev/null; then
    echo "✅ Preflight check passed"
    echo ""
    echo "=========================================="
    echo "✅ Demo READY"
    echo "=========================================="
    echo ""
    echo "Operator Commands:"
    echo "  Open app:     http://127.0.0.1:5173/app"
    echo "  Health check: curl -s http://127.0.0.1:3001/health"
    echo "  Preflight:    curl -s http://127.0.0.1:3001/api/execute/preflight"
    echo "  V1 smoke:      ./scripts/v1-smoke.sh"
    echo ""
    echo "Frontend: http://127.0.0.1:5173"
    echo "Backend:  http://127.0.0.1:3001"
    echo ""
    echo "Opening app in browser..."
    # Try to open in browser (macOS/linux)
    if command -v open &> /dev/null; then
      open http://127.0.0.1:5173/app 2>/dev/null || true
    elif command -v xdg-open &> /dev/null; then
      xdg-open http://127.0.0.1:5173/app 2>/dev/null || true
    fi
    echo ""
  else
    echo "⚠️  Preflight check failed or returned warnings"
    echo "   Response: $PREFLIGHT_RESPONSE" | head -c 200
    echo ""
    echo "=========================================="
    echo "⚠️  Demo started but not fully configured"
    echo "=========================================="
    echo ""
    echo "Check configuration:"
    echo "  - ETH_TESTNET_RPC_URL"
    echo "  - EXECUTION_ROUTER_ADDRESS"
    echo "  - BLOSSOM_GEMINI_API_KEY (or other LLM key)"
    echo ""
    echo "Run: ./scripts/v1-smoke.sh for detailed checks"
    echo ""
    echo "Frontend: http://127.0.0.1:5173"
    echo "Backend:  http://127.0.0.1:3001"
    echo ""
  fi
  
  echo "Press Ctrl+C to stop both services"
  echo "=========================================="
  echo ""
  
  # Wait for user interrupt
  wait $DEMO_PID
else
  echo "❌ Backend health check failed after ${MAX_WAIT}s"
  echo ""
  echo "Checking logs..."
  echo ""
  
  # Show last 80 lines of demo log
  if [ -f /tmp/blossom-demo.log ]; then
    echo "Last 80 lines of startup log:"
    echo "----------------------------------------"
    tail -80 /tmp/blossom-demo.log
    echo "----------------------------------------"
    echo ""
  fi
  
  # Check for specific error patterns
  if grep -q "concurrently: command not found" /tmp/blossom-demo.log 2>/dev/null; then
    echo "❌ Error: concurrently not found"
    echo ""
    echo "Fix: Run 'npm install' to install dependencies"
    echo ""
  fi
  
  if grep -q "EADDRINUSE\|port.*5173.*already in use\|Port 5173 is in use" /tmp/blossom-demo.log 2>/dev/null; then
    echo "⚠️  Port 5173 already in use"
    echo ""
    echo "Fix: Kill processes on port 5173, then retry:"
    echo "  lsof -ti :5173 | xargs kill -9"
    echo ""
  fi
  
  # Check for Vite port fallback (should not happen with strictPort: true)
  if grep -q "5174\|port.*5174" /tmp/blossom-demo.log 2>/dev/null; then
    echo "⚠️  WARNING: Vite may have fallen back to port 5174"
    echo "   This should not happen with strictPort: true"
    echo "   Check vite.config.ts has strictPort: true"
    echo ""
  fi
  
  echo "=========================================="
  echo "Manual Fallback Commands:"
  echo "=========================================="
  echo ""
  echo "Terminal 1 (Backend):"
  echo "  cd agent"
  echo "  PORT=3001 npm run dev"
  echo ""
  echo "Terminal 2 (Frontend):"
  echo "  npm run dev"
  echo ""
  echo "Then verify:"
  echo "  curl -s http://127.0.0.1:3001/health"
  echo ""
  echo "=========================================="
  echo ""
  
  kill $DEMO_PID 2>/dev/null || true
  exit 1
fi

