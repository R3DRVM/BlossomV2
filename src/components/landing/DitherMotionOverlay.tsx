/**
 * Premium Dither + ASCII + Motion Overlay
 * Adds sophisticated visual texture to landing page
 */

import { useEffect, useRef } from 'react';

interface DitherMotionOverlayProps {
  intensity?: number;
  speed?: number;
  color?: string;
}

export const DitherMotionOverlay: React.FC<DitherMotionOverlayProps> = ({
  intensity = 0.3,
  speed = 1,
  color = '#F25AA2', // Blossom pink
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to full screen
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ASCII characters for dithering (from sparse to dense)
    const ASCII_CHARS = ' ·∴∵∷⋮⁞⁝⋯⸱•∙⊙◦○◌◍◎●';

    // Particle system for motion
    class Particle {
      x!: number;
      y!: number;
      vx!: number;
      vy!: number;
      life!: number;
      maxLife!: number;
      char!: string;
      size!: number;

      constructor() {
        this.reset();
      }

      reset() {
        this.x = Math.random() * (canvas?.width ?? window.innerWidth);
        this.y = Math.random() * (canvas?.height ?? window.innerHeight);
        this.vx = (Math.random() - 0.5) * speed * 0.5;
        this.vy = (Math.random() - 0.5) * speed * 0.5;
        this.maxLife = Math.random() * 200 + 100;
        this.life = this.maxLife;
        this.char = ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)];
        this.size = Math.random() * 8 + 8;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;

        // Wrap around edges
        if (this.x < 0) this.x = canvas!.width;
        if (this.x > canvas!.width) this.x = 0;
        if (this.y < 0) this.y = canvas!.height;
        if (this.y > canvas!.height) this.y = 0;

        if (this.life <= 0) {
          this.reset();
        }
      }

      draw() {
        const alpha = (this.life / this.maxLife) * intensity;
        ctx!.globalAlpha = alpha;
        ctx!.font = `${this.size}px monospace`;
        ctx!.fillStyle = color;
        ctx!.fillText(this.char, this.x, this.y);
      }
    }

    // Create particle field
    const particleCount = Math.floor((canvas!.width * canvas!.height) / 5000);
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle());
    }

    // Dithering pattern for background texture
    function drawDitherPattern(time: number) {
      const cellSize = 40;
      ctx!.globalAlpha = intensity * 0.2;
      ctx!.font = '10px monospace';

      for (let y = 0; y < canvas!.height; y += cellSize) {
        for (let x = 0; x < canvas!.width; x += cellSize) {
          // Distance-based wave effect
          const distance = Math.sqrt(
            Math.pow(x - canvas!.width / 2, 2) +
            Math.pow(y - canvas!.height / 2, 2)
          );
          const wave = Math.sin(distance * 0.005 + time * 0.001) * 0.5 + 0.5;

          // Dither based on wave value
          if (Math.random() < wave * intensity) {
            const charIndex = Math.floor(wave * (ASCII_CHARS.length - 1));
            const char = ASCII_CHARS[charIndex];
            ctx!.fillStyle = color;
            ctx!.fillText(char, x, y);
          }
        }
      }
    }

    // Animation loop
    let time = 0;
    let animationId: number;

    function animate() {
      time++;

      // Clear with fade effect for trails
      ctx!.globalAlpha = 0.1;
      ctx!.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      // Draw subtle dither pattern
      drawDitherPattern(time);

      // Reset alpha for particles
      ctx!.globalAlpha = 1;

      // Update and draw particles
      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });

      animationId = requestAnimationFrame(animate);
    }

    animate();

    // Mouse interaction - particles avoid cursor
    const handleMouseMove = (e: MouseEvent) => {
      particles.forEach((particle) => {
        const dx = e.clientX - particle.x;
        const dy = e.clientY - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 150) {
          const force = (150 - distance) / 150;
          particle.vx -= (dx / distance) * force * 0.5;
          particle.vy -= (dy / distance) * force * 0.5;
        }
      });
    };

    canvas!.addEventListener('mousemove', handleMouseMove);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resizeCanvas);
      canvas!.removeEventListener('mousemove', handleMouseMove);
    };
  }, [intensity, speed, color]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[5]"
      style={{
        mixBlendMode: 'multiply',
        opacity: 0.6,
      }}
    />
  );
};
