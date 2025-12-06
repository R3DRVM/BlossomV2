/**
 * Cherry Blossom Background
 * Premium white background with cherry blossom illustration on left/bottom
 * Subtle petal animation in hero section only
 */

// Petal SVG shape
const PETAL_SHAPE = 'M50,0 C60,10 65,25 60,40 C55,35 45,30 40,20 C35,10 40,5 50,0 Z';

export function CherryBlossomBackground() {
  // Generate 5-7 subtle petals for hero section only
  const petals = Array.from({ length: 6 }, (_, i) => ({
    id: i,
    startX: `${10 + Math.random() * 30}%`, // Start from top-left/center
    startY: `${-5 + Math.random() * 15}%`,
    delay: Math.random() * 5,
    duration: 18 + Math.random() * 6, // 18-24s slow drift
    size: 18 + Math.random() * 8, // 18-26px - larger, subtle
    rotation: Math.random() * 360,
    opacity: 0.25 + Math.random() * 0.15, // 25-40% opacity - subtle
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-white">
      {/* Cherry blossom illustration - anchored left & bottom */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
        <img
          src="/cherry-branch.png"
          alt="Cherry blossoms"
          className="absolute object-contain"
          style={{
            left: '-80px',
            bottom: '-40px',
            width: '460px',
            opacity: 0.85,
            objectFit: 'contain',
          }}
          onError={(e) => {
            // Fallback: try cherry-tree.png if cherry-branch.png doesn't exist
            const target = e.target as HTMLImageElement;
            if (target.src.includes('cherry-branch')) {
              target.src = '/cherry-tree.png';
              target.onerror = () => {
                // Final fallback SVG
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = `
                    <svg viewBox="0 0 400 500" class="absolute" style="left: -80px; bottom: -40px; width: 460px; opacity: 0.85;" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M50 500 L50 350 Q50 300 80 280 Q110 260 100 300 Q90 340 70 380 L50 500" 
                            stroke="#F25AA2" stroke-width="4" fill="none" opacity="0.6"/>
                      <ellipse cx="120" cy="200" rx="80" ry="100" fill="#FFB6D9" opacity="0.4"/>
                      <ellipse cx="180" cy="150" rx="90" ry="110" fill="#FFB6D9" opacity="0.4"/>
                      <ellipse cx="140" cy="100" rx="70" ry="90" fill="#FFB6D9" opacity="0.35"/>
                    </svg>
                  `;
                }
              };
            }
          }}
        />
      </div>

      {/* Animated sakura petals - subtle drift, hero section only */}
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
            animation: `sakura-fall ${petal.duration}s ease-out infinite`,
            animationDelay: `${petal.delay}s`,
            opacity: petal.opacity,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <path
              d={PETAL_SHAPE}
              fill="rgba(242, 90, 162, 0.4)"
              stroke="rgba(255, 182, 217, 0.3)"
              strokeWidth="0.5"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}
