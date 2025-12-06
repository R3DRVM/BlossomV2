/**
 * Cherry Blossom Background
 * Premium background with clearly visible cherry blossom tree and subtle petal animation
 * Early-morning rural Japan aesthetic - calm, serene, premium
 */

// Petal SVG shapes for variation
const PETAL_SHAPES = [
  // Petal shape 1: classic rounded
  'M50,0 C60,10 65,25 60,40 C55,35 45,30 40,20 C35,10 40,5 50,0 Z',
  // Petal shape 2: slightly elongated
  'M50,0 C55,8 58,20 55,35 C50,30 45,25 42,15 C38,8 42,3 50,0 Z',
  // Petal shape 3: more rounded
  'M50,0 C58,12 62,28 58,42 C52,38 46,32 44,22 C40,12 44,5 50,0 Z',
];

export function CherryBlossomBackground() {
  // Generate 12-14 visible petals with varied properties
  const petals = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    startX: `${80 + Math.random() * 15}%`, // Start from top-right
    startY: `${-5 + Math.random() * 20}%`,
    delay: Math.random() * 8, // Store as number for easier debugging
    duration: 16 + Math.random() * 8, // 16-24s for very slow drift
    size: 12 + Math.random() * 10, // 12-22px - larger for visibility
    rotation: Math.random() * 360,
    opacity: 0.3 + Math.random() * 0.3, // 30-60% opacity - more visible
    shapeIndex: Math.floor(Math.random() * PETAL_SHAPES.length),
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden sakura-hero-bg pointer-events-none">
      {/* Cherry blossom tree - clearly visible, anchored bottom-right */}
      <div className="hidden lg:block absolute right-0 bottom-0 pointer-events-none" style={{ 
        width: '900px',
        height: '1100px',
        zIndex: 1,
        transform: 'translate(15%, 0)', // Partially off-screen, growing from corner
      }}>
        <img
          src="/cherry-tree.png"
          alt="Cherry blossom tree"
          className="w-full h-full object-contain"
          style={{
            opacity: 0.75, // More visible
            mixBlendMode: 'normal', // No blend mode for maximum visibility
            filter: 'blur(1px)', // Minimal blur
          }}
          onError={(e) => {
            // Fallback SVG - always show something
            const target = e.target as HTMLImageElement;
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `
                <svg viewBox="0 0 400 600" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.75;">
                  <path d="M200 600 L200 400 Q200 350 180 320 Q160 290 140 320 Q120 350 120 400 L120 600" 
                        stroke="#F25AA2" stroke-width="5" fill="none" opacity="0.7"/>
                  <ellipse cx="150" cy="250" rx="100" ry="120" fill="#FFB6D9" opacity="0.5"/>
                  <ellipse cx="250" cy="200" rx="110" ry="130" fill="#FFB6D9" opacity="0.5"/>
                  <ellipse cx="180" cy="150" rx="90" ry="110" fill="#FFB6D9" opacity="0.45"/>
                  <ellipse cx="220" cy="180" rx="80" ry="100" fill="#FFB6D9" opacity="0.4"/>
                </svg>
              `;
            }
          }}
        />
      </div>

      {/* Mobile: centered tree with reduced opacity */}
      <div className="lg:hidden absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 1 }}>
        <img
          src="/cherry-tree.png"
          alt="Cherry blossom tree"
          className="w-[400px] h-[500px] object-contain"
          style={{
            opacity: 0.6,
            mixBlendMode: 'normal',
            filter: 'blur(1px)',
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `
                <svg viewBox="0 0 400 600" class="w-[400px] h-[500px]" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.5; mix-blend-mode: multiply;">
                  <path d="M200 600 L200 400 Q200 350 180 320 Q160 290 140 320 Q120 350 120 400 L120 600" 
                        stroke="#F25AA2" stroke-width="3" fill="none" opacity="0.5"/>
                  <ellipse cx="150" cy="250" rx="100" ry="120" fill="#FFB6D9" opacity="0.3"/>
                  <ellipse cx="250" cy="200" rx="110" ry="130" fill="#FFB6D9" opacity="0.3"/>
                </svg>
              `;
            }
          }}
        />
      </div>

      {/* Animated sakura petals - visible drift from top-right to bottom-left */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute sakura-petal"
          style={{
            left: petal.startX,
            top: petal.startY,
            width: `${petal.size}px`,
            height: `${petal.size}px`,
            transform: `rotate(${petal.rotation}deg)`,
            animation: `sakura-wind ${petal.duration}s ease-out infinite`,
            animationDelay: `${petal.delay}s`,
            opacity: petal.opacity,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <path
              d={PETAL_SHAPES[petal.shapeIndex]}
              fill="rgba(242, 90, 162, 0.6)"
              stroke="rgba(255, 182, 217, 0.4)"
              strokeWidth="1"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

