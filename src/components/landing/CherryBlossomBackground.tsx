/**
 * Cherry Blossom Background
 * White background with cherry blossom image and falling petals
 * Based on SuddenGreenCad reference design
 */

import cherryBlossomBg from '../../assets/cherry-blossom-bg.png';

// Petal SVG shape
const PETAL_SHAPE = 'M50,0 C60,10 65,25 60,40 C55,35 45,30 40,20 C35,10 40,5 50,0 Z';

export function CherryBlossomBackground() {
  // Generate subtle petals - fewer, more elegant
  const petals = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    startX: `${-50 + Math.random() * 30}px`, // Start from left, off-screen
    startY: `${Math.random() * 30}%`, // Top portion
    delay: Math.random() * 5,
    duration: 10 + Math.random() * 15, // 10-25s for slow drift
    size: 16 + Math.random() * 12, // 16-28px
    rotation: Math.random() * 360,
    opacity: 0.3 + Math.random() * 0.5, // 30-80% opacity
  }));

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-white">
      {/* Cherry blossom background image - softly blurred, anchored left/bottom */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
        <img
          src={cherryBlossomBg}
          alt="Cherry blossom background"
          className="absolute object-cover"
          style={{
            left: '-10%',
            bottom: '-10%',
            width: '60%',
            height: '80%',
            opacity: 0.6,
            mixBlendMode: 'multiply',
            filter: 'blur(2px)',
            objectFit: 'cover',
          }}
        />
      </div>

      {/* Animated sakura petals - drift from left to right, top to bottom */}
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
            animation: `sakura-drift ${petal.duration}s linear infinite`,
            animationDelay: `${petal.delay}s`,
            opacity: petal.opacity,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <path
              d={PETAL_SHAPE}
              fill="rgba(242, 90, 162, 0.5)"
              stroke="rgba(255, 182, 217, 0.4)"
              strokeWidth="0.5"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

