/**
 * Cherry Blossom Background
 * Light premium background with cherry blossom tree and animated petals
 * Minimalist Japanese fintech aesthetic
 */

export function CherryBlossomBackground() {
  // Generate 10-12 subtle petals with random positions and delays
  const petals = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    startX: `${Math.random() * 20}%`, // Start from right/top area
    startY: `${-5 + Math.random() * 15}%`,
    delay: `${Math.random() * 8}s`,
    duration: `${10 + Math.random() * 8}s`, // 10-18s for slow drift
    size: `${5 + Math.random() * 6}px`, // 5-11px - small and subtle
    rotation: Math.random() * 360,
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden sakura-hero-bg pointer-events-none">
      {/* Cherry blossom tree illustration (right side, desktop only) */}
      <div className="hidden lg:block absolute right-0 bottom-0 w-[600px] h-[800px] sakura-tree pointer-events-none">
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
                        stroke="#FFD6E6" stroke-width="3" fill="none" opacity="0.3"/>
                  <ellipse cx="150" cy="250" rx="100" ry="120" fill="#FFD6E6" opacity="0.15"/>
                  <ellipse cx="250" cy="200" rx="110" ry="130" fill="#FFD6E6" opacity="0.15"/>
                  <ellipse cx="180" cy="150" rx="90" ry="110" fill="#FFD6E6" opacity="0.12"/>
                </svg>
              `;
            }
          }}
        />
      </div>

      {/* Animated sakura petals - very subtle */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute sakura-petal"
          style={{
            left: petal.startX,
            top: petal.startY,
            width: petal.size,
            height: petal.size,
            background: `radial-gradient(circle, rgba(255,214,230,0.3) 0%, rgba(255,102,160,0.2) 100%)`,
            borderRadius: '50% 0 50% 50%',
            transform: `rotate(${petal.rotation}deg)`,
            animation: `sakura-fall ${petal.duration} linear infinite`,
            animationDelay: petal.delay,
            filter: 'blur(1px)',
          }}
        />
      ))}
    </div>
  );
}

