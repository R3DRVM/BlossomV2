/**
 * Cherry Blossom Background
 * Dark premium background with animated cherry blossom scene
 */

export function CherryBlossomBackground() {
  // Generate 10-12 petals with random positions and delays
  const petals = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    delay: `${Math.random() * 15}s`,
    duration: `${15 + Math.random() * 15}s`, // 15-30s
    size: `${8 + Math.random() * 12}px`, // 8-20px
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      {/* Base gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at top, #1B1024 0%, #050816 50%, #0A0E1A 100%)',
        }}
      />

      {/* Cherry blossom tree silhouette (bottom-left) */}
      <div className="absolute bottom-0 left-0 w-96 h-96 opacity-20 pointer-events-none">
        <svg
          viewBox="0 0 400 400"
          className="w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Tree trunk */}
          <path
            d="M 200 400 L 200 250 Q 200 200 180 180 Q 160 160 140 180 Q 120 200 120 250 L 120 400"
            stroke="#FF7EB3"
            strokeWidth="2"
            fill="none"
            opacity="0.3"
          />
          {/* Canopy blobs */}
          <ellipse cx="150" cy="150" rx="80" ry="100" fill="#FF7EB3" opacity="0.15" />
          <ellipse cx="250" cy="120" rx="90" ry="110" fill="#FFD1E8" opacity="0.15" />
          <ellipse cx="180" cy="100" rx="70" ry="90" fill="#FF7EB3" opacity="0.12" />
        </svg>
      </div>

      {/* Animated petals */}
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute rounded-full blur-sm pointer-events-none"
          style={{
            left: petal.left,
            top: petal.top,
            width: petal.size,
            height: petal.size,
            background: `radial-gradient(circle, rgba(255,214,232,0.6) 0%, rgba(255,126,179,0.4) 100%)`,
            animation: `driftBlossom ${petal.duration} linear infinite`,
            animationDelay: petal.delay,
            transform: 'rotate(45deg)',
          }}
        />
      ))}
    </div>
  );
}

