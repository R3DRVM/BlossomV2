#!/bin/bash
# Quick integration script
# Run this from bloom directory

echo "🎨 Applying premium dither + motion overlay..."

# Backup original
cp src/pages/LandingPage.tsx src/pages/LandingPage.tsx.backup

# Add import after existing imports (after line 10)
sed -i '' '10a\
import { PremiumGrainOverlay } from '\''../components/landing/PremiumGrainOverlay'\'';
' src/pages/LandingPage.tsx

# Add component after CherryBlossomBackground
sed -i '' 's/<CherryBlossomBackground \/>/<CherryBlossomBackground \/>\n      <PremiumGrainOverlay intensity={0.12} \/>/g' src/pages/LandingPage.tsx

echo "✅ Integration complete!"
echo "📄 Backup saved: src/pages/LandingPage.tsx.backup"
echo "🚀 Run 'npm run dev' to see the effect"
echo ""
echo "To revert: mv src/pages/LandingPage.tsx.backup src/pages/LandingPage.tsx"
