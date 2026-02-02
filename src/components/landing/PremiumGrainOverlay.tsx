/**
 * Premium Film Grain + Dither Overlay
 * Subtle texture overlay for premium feel
 * Inspired by high-end design with motion
 */

import { useEffect, useRef } from 'react';

interface PremiumGrainOverlayProps {
  intensity?: number;
  grain?: boolean;
  dither?: boolean;
  animate?: boolean;
}

export const PremiumGrainOverlay: React.FC<PremiumGrainOverlayProps> = ({
  intensity = 0.15,
  grain = true,
  dither = true,
  animate = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Set canvas to full screen
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Film grain effect
    function drawFilmGrain() {
      const imageData = ctx!.createImageData(canvas!.width, canvas!.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const noise = Math.random() * 255 * intensity;
        data[i] = noise; // R
        data[i + 1] = noise; // G
        data[i + 2] = noise; // B
        data[i + 3] = intensity * 100; // Alpha
      }

      ctx!.putImageData(imageData, 0, 0);
    }

    // Halftone/dither pattern
    function drawDitherPattern(offsetX = 0, offsetY = 0) {
      const dotSize = 3;
      const spacing = 8;
      ctx!.fillStyle = 'rgba(0, 0, 0, 0.05)';

      for (let y = offsetY; y < canvas!.height + spacing; y += spacing) {
        for (let x = offsetX; x < canvas!.width + spacing; x += spacing) {
          // Varying dot sizes based on position
          const distance = Math.sqrt(
            Math.pow((x - canvas!.width / 2) / canvas!.width, 2) +
            Math.pow((y - canvas!.height / 2) / canvas!.height, 2)
          );
          const size = dotSize * (0.5 + distance * 0.5);

          ctx!.beginPath();
          ctx!.arc(x, y, size, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    // Scanline effect
    function drawScanlines() {
      ctx!.fillStyle = 'rgba(0, 0, 0, 0.02)';
      for (let y = 0; y < canvas!.height; y += 2) {
        ctx!.fillRect(0, y, canvas!.width, 1);
      }
    }

    // Animation loop
    let animationId: number;
    let frame = 0;

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Film grain (changes every frame)
      if (grain) {
        drawFilmGrain();
      }

      // Dither pattern (subtle movement)
      if (dither) {
        const offset = Math.sin(frame * 0.02) * 2;
        drawDitherPattern(offset, offset);
      }

      // Scanlines (static)
      drawScanlines();

      frame++;
      if (animate) {
        animationId = requestAnimationFrame(animate);
      }
    }

    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [intensity, grain, dither, animate]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[5]"
      style={{
        mixBlendMode: 'multiply',
        opacity: 0.8,
      }}
    />
  );
};
