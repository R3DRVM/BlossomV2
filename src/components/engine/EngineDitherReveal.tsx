/**
 * Engine hero: visual clone of engine.jpg with dither (transparent bg, pink/white strokes).
 * Progressive reveal by step via 6 regions; final step = full clarity + beam glow.
 */

import { useRef, useEffect, useCallback } from 'react';

import engineUrl from '../../assets/engine.jpg?url';

const MAX_FPS = 30;

/** 6 reveal regions: each entry is [yStartFraction, yEndFraction]. Step i reveals regions 0..i. */
export const ENGINE_REVEAL_BANDS: [number, number][] = [
  [0, 0.22],
  [0.22, 0.42],
  [0.42, 0.58],
  [0.58, 0.72],
  [0.72, 0.88],
  [0.88, 1],
];

/** Luminance above this = stroke (pink/white). Below = transparent. */
export const ENGINE_DITHER_THRESHOLD = 0.28;
/** Stroke brightness boost at final step (0–1). */
export const ENGINE_FINAL_GLOW_BOOST = 0.35;

export interface EngineDitherRevealProps {
  /** 0..5 active step; 5 = full reveal + glow */
  activeStep: number;
  /** Light mode = use darker pink for contrast on white */
  isDark?: boolean;
  className?: string;
}

export function EngineDitherReveal({ activeStep, isDark = false, className = '' }: EngineDitherRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastDrawRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    if (now - lastDrawRef.current < 1000 / MAX_FPS) return;
    lastDrawRef.current = now;

    const img = imgRef.current;
    const w = canvas.width;
    const h = canvas.height;
    if (!img || !img.complete || !img.naturalWidth) {
      ctx.clearRect(0, 0, w, h);
      return;
    }

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = w / dpr;
    const cssH = h / dpr;
    const scale = Math.min(cssW / iw, cssH / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const sx = (cssW - drawW) / 2;
    const sy = (cssH - drawH) / 2;

    const ow = Math.min(iw, 800);
    const oh = Math.floor((ih / iw) * ow);
    const off = document.createElement('canvas');
    off.width = ow;
    off.height = oh;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    offCtx.drawImage(img, 0, 0, iw, ih, 0, 0, ow, oh);
    const srcData = offCtx.getImageData(0, 0, ow, oh);
    const src = srcData.data;
    const out = offCtx.createImageData(ow, oh);
    const outData = out.data;
    const thresh = ENGINE_DITHER_THRESHOLD;
    const isFinal = activeStep >= 5;
    const strokeBoost = isFinal ? ENGINE_FINAL_GLOW_BOOST : 0;

    const strokeR = isDark ? 244 : 185;
    const strokeG = isDark ? 114 : 55;
    const strokeB = isDark ? 182 : 125;
    const whiteR = 255;
    const whiteG = isDark ? 250 : 255;
    const whiteB = isDark ? 250 : 255;

    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const i = (y * ow + x) * 4;
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        const L = (r + g + b) / (3 * 255);
        const isCyan = g > r && b > r && (g + b) / 2 > r + 30;
        const isLight = L > thresh || isCyan;
        if (!isLight) {
          outData[i] = 0;
          outData[i + 1] = 0;
          outData[i + 2] = 0;
          outData[i + 3] = 0;
        } else {
          const t = Math.min(1, L + strokeBoost);
          outData[i] = Math.round(strokeR + (whiteR - strokeR) * t);
          outData[i + 1] = Math.round(strokeG + (whiteG - strokeG) * t);
          outData[i + 2] = Math.round(strokeB + (whiteB - strokeB) * t);
          outData[i + 3] = 255;
        }
      }
    }

    offCtx.putImageData(out, 0, 0);

    const sxpx = sx * dpr;
    const sypx = sy * dpr;
    const drawWpx = drawW * dpr;
    const drawHpx = drawH * dpr;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    for (let step = 0; step <= activeStep; step++) {
      const [y0, y1] = ENGINE_REVEAL_BANDS[step];
      const clipY0 = sypx + drawHpx * y0;
      const clipY1 = sypx + drawHpx * y1;
      ctx.rect(0, clipY0, w, clipY1 - clipY0);
    }
    ctx.clip();
    ctx.drawImage(off, 0, 0, ow, oh, sxpx, sypx, drawWpx, drawHpx);

    if (isFinal) {
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = 'var(--blossom-engine-glow)';
      ctx.fillRect(sxpx, sypx, drawWpx, drawHpx);
    }

    ctx.restore();
  }, [activeStep, isDark]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = engineUrl;
    img.onload = () => { imgRef.current = img; };
    imgRef.current = img;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
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
    <div ref={containerRef} className={`relative w-full aspect-[4/3] max-h-[520px] min-h-[320px] ${className}`}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full object-contain"
        style={{ display: 'block' }}
        aria-hidden
      />
    </div>
  );
}

export default EngineDitherReveal;
