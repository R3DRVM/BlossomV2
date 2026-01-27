#!/bin/bash

#
# Backend Health Check Script
# Verifies GET /health and prints actionable output
#

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"

echo "Checking backend health at $BACKEND_URL/health..."

HEALTH_RESPONSE=$(curl -s --max-time 5 "$BACKEND_URL/health" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "❌ Backend is not reachable"
  echo ""
  echo "To start the backend:"
  echo "  npm run dev:demo"
  echo ""
  echo "Or manually:"
  echo "  cd agent"
  echo "  PORT=3001 npm run dev"
  exit 1
fi

# Check if response contains "ok"
if echo "$HEALTH_RESPONSE" | grep -q '"ok"'; then
  echo "✅ Backend is healthy"
  echo "$HEALTH_RESPONSE" | jq . 2>/dev/null || echo "$HEALTH_RESPONSE"
  exit 0
else
  echo "⚠️  Backend responded but health check failed"
  echo "Response: $HEALTH_RESPONSE"
  exit 1
fi


