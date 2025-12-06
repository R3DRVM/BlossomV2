/**
 * Cherry Blossom Background
 * Light premium background with cherry blossom tree and animated petals
 * Minimalist Japanese fintech aesthetic
 */

export function CherryBlossomBackground() {
  // Generate 8-10 graceful petals with random positions and delays
  const petals = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    startX: `${60 + Math.random() * 30}%`, // Start from right side
    startY: `${-5 + Math.random() * 20}%`,
    delay: `${Math.random() * 10}s`,
    duration: `${12 + Math.random() * 8}s`, // 12-20s for slow, graceful movement
    size: `${6 + Math.random() * 8}px`, // 6-14px
    rotation: Math.random() * 360,
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden sakura-hero-bg pointer-events-none">
      {/* Cherry blossom tree illustration (right side, behind chat card) */}
      <div className="hidden lg:block absolute right-0 bottom-0 w-[700px] h-[900px] pointer-events-none" style={{ zIndex: 1 }}>
        <img
          src="/cherry-tree-hero.png"
          alt="Cherry blossom tree"
          className="w-full h-full object-contain"
          style={{
            opacity: 0.75,
            filter: 'drop-shadow(0 4px 12px rgba(255, 95, 168, 0.15))',
          }}
          onError={(e) => {
            // Fallback SVG if image doesn't exist
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `
                <svg viewBox="0 0 400 600" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.75;">
                  <path d="M200 600 L200 400 Q200 350 180 320 Q160 290 140 320 Q120 350 120 400 L120 600" 
                        stroke="#FFD6E6" stroke-width="3" fill="none" opacity="0.4"/>
                  <ellipse cx="150" cy="250" rx="100" ry="120" fill="#FFD6E6" opacity="0.2"/>
                  <ellipse cx="250" cy="200" rx="110" ry="130" fill="#FFD6E6" opacity="0.2"/>
                  <ellipse cx="180" cy="150" rx="90" ry="110" fill="#FFD6E6" opacity="0.18"/>
                </svg>
              `;
            }
          }}
        />
      </div>

      {/* Animated sakura petals - graceful drift */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute sakura-petal"
          style={{
            left: petal.startX,
            top: petal.startY,
            width: petal.size,
            height: petal.size,
            background: `radial-gradient(circle, rgba(255,95,168,0.25) 0%, rgba(255,214,230,0.2) 100%)`,
            borderRadius: '50% 0 50% 50%',
            transform: `rotate(${petal.rotation}deg)`,
            animation: `sakura-fall ${petal.duration} linear infinite`,
            animationDelay: petal.delay,
            filter: 'blur(0.5px)',
            zIndex: 2,
          }}
        />
      ))}
    </div>
  );
}

