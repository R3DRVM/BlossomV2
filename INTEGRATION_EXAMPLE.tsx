/**
 * Integration Example for LandingPage.tsx
 * 
 * ADD THIS IMPORT at the top of the file:
 */
import { PremiumGrainOverlay } from '../components/landing/PremiumGrainOverlay';
// OR for more dramatic effect:
// import { DitherMotionOverlay } from '../components/landing/DitherMotionOverlay';

/**
 * THEN ADD THIS COMPONENT in the return statement,
 * right after <CherryBlossomBackground />
 * 
 * Find this section (around line 80-85):
 */

export default function LandingPage() {
  // ... existing code ...

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans relative overflow-x-hidden">
      {/* Use Blossom's existing cherry blossom background/animation */}
      <CherryBlossomBackground />
      
      {/* ✨ ADD THIS LINE: */}
      <PremiumGrainOverlay intensity={0.12} />
      {/* OR for ASCII particle effect: */}
      {/* <DitherMotionOverlay intensity={0.25} speed={0.8} color="#F25AA2" /> */}

      <Navigation navigate={navigate} />
      
      {/* ... rest of the component ... */}
    </div>
  );
}

/**
 * CUSTOMIZATION OPTIONS:
 * 
 * PremiumGrainOverlay:
 * - intensity: 0.08 (subtle) to 0.3 (strong)
 * - grain: true/false (film grain effect)
 * - dither: true/false (halftone dots)
 * - animate: true/false (motion)
 * 
 * DitherMotionOverlay:
 * - intensity: 0.2 to 0.4
 * - speed: 0.5 to 2 (particle speed)
 * - color: any hex color (default: "#F25AA2")
 */
