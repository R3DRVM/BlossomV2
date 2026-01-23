#!/bin/bash

# Verification script for Website Lock Gate
# This script helps verify the gate is enabled on production and disabled locally

echo "🔒 Website Lock Gate Verification"
echo "=================================="
echo ""

# Check if gate component exists
if [ -f "src/components/WebsiteLock.tsx" ]; then
  echo "✅ WebsiteLock component exists"
else
  echo "❌ WebsiteLock component not found"
  exit 1
fi

# Check if main.tsx includes WebsiteLock
if grep -q "WebsiteLock" src/main.tsx; then
  echo "✅ WebsiteLock integrated in main.tsx"
else
  echo "❌ WebsiteLock not found in main.tsx"
  exit 1
fi

echo ""
echo "📋 Manual Verification Steps:"
echo ""
echo "1. LOCAL TEST (should NOT show gate):"
echo "   - Run: npm run dev"
echo "   - Visit: http://localhost:5173"
echo "   - Expected: No overlay, site loads normally"
echo ""
echo "2. PRODUCTION TEST (should show gate):"
echo "   - Visit: https://blossomv2.fly.dev"
echo "   - Expected: Overlay appears with password field"
echo "   - Enter password: 'bloom' (case-insensitive)"
echo "   - Expected: Overlay disappears, site accessible"
echo ""
echo "3. PERSISTENCE TEST:"
echo "   - After unlocking, refresh the page"
echo "   - Expected: No overlay (unlock persists)"
echo ""
echo "4. RE-LOCK TEST:"
echo "   - Press Cmd+L (Mac) or Ctrl+L (Windows/Linux)"
echo "   - Expected: Overlay reappears"
echo ""
echo "5. ENV OVERRIDE TEST (optional):"
echo "   - Set VITE_GATE_ENABLED=true in .env"
echo "   - Run: npm run dev"
echo "   - Expected: Gate appears on localhost"
echo "   - Set VITE_GATE_ENABLED=false to disable"
echo ""
echo "✅ Verification script complete!"
echo ""
echo "💡 Quick browser console check:"
echo "   localStorage.getItem('BLOSSOM_GATE_UNLOCKED')"
echo "   (Should return null when locked, or JSON with expiry when unlocked)"
