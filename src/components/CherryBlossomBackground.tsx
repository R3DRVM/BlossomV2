/**
 * Cherry Blossom Background
 * Premium background with real cherry blossom tree and organic petal animation
 * Minimalist Japanese fintech aesthetic
 */

export function CherryBlossomBackground() {
  // Generate 12-15 organic petals with varied properties for believable wind effect
  const petals = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    startX: `${75 + Math.random() * 20}%`, // Start from right side (wind source)
    startY: `${-10 + Math.random() * 25}%`,
    delay: `${Math.random() * 12}s`,
    duration: `${14 + Math.random() * 10}s`, // 14-24s for slow, organic drift
    size: `${8 + Math.random() * 10}px`, // 8-18px - varied sizes
    rotation: Math.random() * 360,
    opacity: 0.3 + Math.random() * 0.3, // 30-60% opacity variation
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden sakura-hero-bg pointer-events-none">
      {/* Real cherry blossom tree - premium photography feel */}
      <div className="hidden lg:block absolute right-0 bottom-0 w-[800px] h-[1000px] sakura-tree" style={{ zIndex: 1 }}>
        <img
          src="/cherry-tree.png"
          alt="Cherry blossom tree"
          className="w-full h-full object-contain"
          onError={(e) => {
            // Fallback SVG if image doesn't exist
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `
                <svg viewBox="0 0 400 600" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M200 600 L200 400 Q200 350 180 320 Q160 290 140 320 Q120 350 120 400 L120 600" 
                        stroke="#FFD6E6" stroke-width="3" fill="none" opacity="0.4"/>
                  <ellipse cx="150" cy="250" rx="100" ry="120" fill="#FFD6E6" opacity="0.25"/>
                  <ellipse cx="250" cy="200" rx="110" ry="130" fill="#FFD6E6" opacity="0.25"/>
                  <ellipse cx="180" cy="150" rx="90" ry="110" fill="#FFD6E6" opacity="0.2"/>
                </svg>
              `;
            }
          }}
        />
      </div>

      {/* Animated sakura petals - organic wind drift from right to left-bottom */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute sakura-petal"
          style={{
            left: petal.startX,
            top: petal.startY,
            width: petal.size,
            height: petal.size,
            background: `radial-gradient(circle, rgba(242,90,162,0.4) 0%, rgba(255,214,230,0.3) 100%)`,
            transform: `rotate(${petal.rotation}deg)`,
            animation: `sakura-wind ${petal.duration} linear infinite`,
            animationDelay: petal.delay,
            filter: 'blur(1px)',
            opacity: petal.opacity,
            zIndex: 2,
          }}
        />
      ))}
    </div>
  );
}

