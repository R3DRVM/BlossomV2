/**
 * Lightweight petal/dot flow overlay for engine funnel.
 * Particles move into top center, some exit left/right at mid, curve back to center.
 * Blossom pink; only runs when funnel is visible and reduced-motion is off.
 */

import { useRef, useEffect, useCallback } from 'react';

const MAX_FPS = 30;
const PARTICLE_COUNT = 24;
const VIEW_W = 320;
const VIEW_H = 360;
const CX = 160;
const CY_TOP = 50;
const CY_MID = 180;
const CY_BOT = 310;

function getPink(): string {
  if (typeof getComputedStyle === 'undefined') return '#FF6BA0';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--blossom-pink').trim();
  return v || '#FF6BA0';
}

export interface EngineParticleFlowProps {
  activeStep: number;
  className?: string;
}

export function EngineParticleFlow({ activeStep, className = '' }: EngineParticleFlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastDrawRef = useRef(0);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || activeStep < 4 || reducedRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    if (now - lastDrawRef.current < 1000 / MAX_FPS) return;
    lastDrawRef.current = now;

    const t = now * 0.0008;
    const w = canvas.width;
    const h = canvas.height;
    const scaleX = w / VIEW_W;
    const scaleY = h / VIEW_H;

    ctx.clearRect(0, 0, w, h);

    const pink = getPink();
    const opacity = 0.5 + (activeStep >= 5 ? 0.25 : 0);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phase = (i / PARTICLE_COUNT + t) % 1;
      const pathType = i % 3;
      let x: number;
      let y: number;

      if (pathType === 0) {
        x = CX + (Math.sin(phase * Math.PI * 2) * 30);
        y = CY_TOP + (CY_BOT - CY_TOP) * phase;
      } else if (pathType === 1) {
        if (phase < 0.4) {
          const s = phase / 0.4;
          x = CX - 80 + 80 * s;
          y = CY_TOP + (CY_MID - CY_TOP) * s;
        } else if (phase < 0.7) {
          const s = (phase - 0.4) / 0.3;
          x = CX - 80 + 160 * s;
          y = CY_MID + (CY_BOT - CY_MID) * s * 0.5;
        } else {
          const s = (phase - 0.7) / 0.3;
          x = CX - 80 + 80 * (1 - s);
          y = CY_MID + (CY_BOT - CY_MID) * (0.5 + 0.5 * s);
        }
      } else {
        if (phase < 0.4) {
          const s = phase / 0.4;
          x = CX + 80 - 80 * s;
          y = CY_TOP + (CY_MID - CY_TOP) * s;
        } else if (phase < 0.7) {
          const s = (phase - 0.4) / 0.3;
          x = CX + 80 - 160 * s;
          y = CY_MID + (CY_BOT - CY_MID) * s * 0.5;
        } else {
          const s = (phase - 0.7) / 0.3;
          x = CX + 80 - 80 * (1 - s);
          y = CY_MID + (CY_BOT - CY_MID) * (0.5 + 0.5 * s);
        }
      }

      const px = x * scaleX;
      const py = y * scaleY;
      const r = 1.5;
      ctx.globalAlpha = opacity * (0.6 + 0.4 * Math.sin(phase * Math.PI * 4));
      ctx.fillStyle = pink;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [activeStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      draw();
    }
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [draw]);

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden />
    </div>
  );
}

export default EngineParticleFlow;
