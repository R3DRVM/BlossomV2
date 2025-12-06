/**
 * Cherry Blossom Background
 * Light premium background with cherry blossom tree and animated petals
 */

export function CherryBlossomBackground() {
  // Generate 8-10 petals with random positions and delays
  const petals = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    startX: `${-10 + Math.random() * 20}%`, // Start slightly off-screen
    startY: `${-5 + Math.random() * 10}%`,
    delay: `${Math.random() * 10}s`,
    duration: `${10 + Math.random() * 10}s`, // 10-20s
    size: `${6 + Math.random() * 8}px`, // 6-14px
    rotation: Math.random() * 360,
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden sakura-hero-bg">
      {/* Cherry blossom tree illustration (right side, desktop only) */}
      <div className="hidden lg:block absolute right-0 bottom-0 w-[600px] h-[800px] opacity-40 mix-blend-multiply pointer-events-none sakura-tree">
        <img
          src="/cherry-tree.png"
          alt="Cherry blossom tree"
          className="w-full h-full object-contain"
          onError={(e) => {
            // Fallback if image doesn't exist yet
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {/* Animated sakura petals */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute sakura-petal pointer-events-none"
          style={{
            left: petal.startX,
            top: petal.startY,
            width: petal.size,
            height: petal.size,
            background: `radial-gradient(circle, rgba(255,182,193,0.4) 0%, rgba(255,105,180,0.3) 100%)`,
            borderRadius: '50% 0 50% 50%',
            transform: `rotate(${petal.rotation}deg)`,
            animation: `sakura-fall ${petal.duration} linear infinite`,
            animationDelay: petal.delay,
          }}
        />
      ))}
    </div>
  );
}

