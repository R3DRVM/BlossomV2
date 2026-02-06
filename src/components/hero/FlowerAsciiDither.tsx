/**
 * Hero flower: procedural dither + aperture mask from blossomascii.jpg only.
 * Cave-in → unfold with scroll (matches blossomstill1..9 shape progression).
 * Do NOT render still images; they are shape references only.
 *
 * DEV NOTE (504): If you see "Outdated Optimize Dep" / blank screen, delete
 * node_modules/.vite and restart Vite with: npm run dev -- --force
 */

import { useRef, useEffect, useCallback, useState } from 'react';

import blossomAsciiUrl from '@/assets/blossomascii.jpg';

const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].flat();

const MAX_FPS = 30;

// ——— Tweak constants ———
const CELL_SIZE = 5;
const DOT_MAX_RADIUS = 2.2;
const DITHER_STRENGTH = 0.55;
const LUM_THRESHOLD = 0.88;
const PETAL_COUNT = 5;
const OPEN_START = 0.15;
const OPEN_END = 0.85;
const CAVE_INTENSITY = 0.7;
const EDGE_SOFTNESS = 0.12;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export interface FlowerAsciiDitherProps {
  /** 0..1 scroll progress: 0 = caved, 1 = full bloom */
  scrollProgress: number;
  bandHeightPx?: number;
  className?: string;
}

export function FlowerAsciiDither({ scrollProgress, bandHeightPx = 480, className = '' }: FlowerAsciiDitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const lastDrawRef = useRef(0);
  const hiddenRef = useRef(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w === 0 || h === 0) return;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, w, h);
        sourceRef.current = { data: id.data, w, h };
      } catch (e) {
        setLoadError(true);
        if (typeof console !== 'undefined' && console.error) {
          console.error('[FlowerAsciiDither] Failed to process blossomascii.jpg', e);
        }
      }
    };
    img.onerror = () => {
      setLoadError(true);
      if (typeof console !== 'undefined' && console.error) {
        console.error('[FlowerAsciiDither] Failed to load blossomascii.jpg');
      }
    };
    img.src = blossomAsciiUrl;
    return () => { sourceRef.current = null; };
  }, []);

  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || hiddenRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    if (now - lastDrawRef.current < 1000 / MAX_FPS) return;
    lastDrawRef.current = now;

    const src = sourceRef.current;
    if (!src) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const { data, w: sw, h: sh } = src;
    const cw = canvas.width;
    const ch = canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cw / dpr;
    const cssH = ch / dpr;

    const cell = Math.max(4, Math.min(7, CELL_SIZE));
    const cols = Math.ceil(cssW / cell);
    const rows = Math.ceil(cssH / cell);

    const reduced = reducedMotionRef.current;
    const p = reduced ? 1 : Math.max(0, Math.min(1, scrollProgress));

    const openT = smoothstep(OPEN_START, OPEN_END, p);
    const caveT = 1 - openT;
    const apertureRadius = 0.25 + 0.75 * openT - CAVE_INTENSITY * caveT * 0.4;

    const cx = 0.5;
    const cy = 0.5;
    const aspect = sw / sh;
    let vw = 1;
    let vh = 1;
    if (cssW / cssH > aspect) {
      vw = (cssW / cssH) / aspect;
    } else {
      vh = (cssH / cssW) * aspect;
    }

    const pink =
      (typeof getComputedStyle !== 'undefined' &&
        getComputedStyle(document.documentElement).getPropertyValue('--blossom-pink').trim()) ||
      '#FF6BA0';

    ctx.clearRect(0, 0, cw, ch);

    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const nx = (ix + 0.5) / cols;
        const ny = (iy + 0.5) / rows;
        const x = (nx - cx) * 2;
        const y = (ny - cy) * 2;
        const rNorm = Math.sqrt(x * x + y * y) / Math.SQRT2;
        const theta = Math.atan2(y, x);

        const lobe = Math.max(0, Math.cos(PETAL_COUNT * theta));
        const lobeMask = 0.3 + 0.7 * lobe * lobe;
        const edge = apertureRadius + EDGE_SOFTNESS;
        const apertureMask = lobeMask * (1 - smoothstep(apertureRadius - EDGE_SOFTNESS, edge, rNorm));

        if (apertureMask < 0.04) continue;

        const u = cx + (x / 2) * vw;
        const v = cy + (y / 2) * vh;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;

        const sx = Math.floor(u * (sw - 1));
        const sy = Math.floor(v * (sh - 1));
        const si = (Math.max(0, Math.min(sh - 1, sy)) * sw + Math.max(0, Math.min(sw - 1, sx))) * 4;
        const R = data[si];
        const G = data[si + 1];
        const B = data[si + 2];
        const L = luminance(R, G, B);

        if (L >= LUM_THRESHOLD) continue;

        const bx = ix % 8;
        const by = iy % 8;
        const bayer = (BAYER_8X8[by * 8 + bx] + 0.5) / 64;
        const Ld = Math.max(0, Math.min(1, L + (L - bayer) * DITHER_STRENGTH));
        const dotAlpha = (1 - Ld) * apertureMask;
        if (dotAlpha < 0.08) continue;

        const px = (nx * cssW) * dpr;
        const py = (ny * cssH) * dpr;
        const radius = Math.max(0.6, Math.min(DOT_MAX_RADIUS, (cell * 0.4 * dpr) / 2)) * Math.min(1, dotAlpha + 0.3);

        ctx.globalAlpha = Math.min(1, dotAlpha * 1.2);
        ctx.fillStyle = pink;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const fadeStart = cssH * 0.6;
    const grad = ctx.createLinearGradient(0, fadeStart * dpr, 0, ch);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    const bgVar =
      typeof getComputedStyle !== 'undefined' &&
      getComputedStyle(document.documentElement).getPropertyValue('--blossom-bg').trim();
    const rgb = bgVar && bgVar.startsWith('#') ? bgVar : '255,255,255';
    const match = rgb.match(/#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
    const [r, g, b] = match
      ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
      : [255, 255, 255];
    grad.addColorStop(1, `rgba(${r},${g},${b},0.92)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  }, [scrollProgress]);

  useEffect(() => {
    const onVisibility = () => { hiddenRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return () => document.removeEventListener('visibilitychange', onVisibility);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
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
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [draw]);

  if (loadError) {
    return (
      <div
        className={`absolute inset-0 flex items-center justify-center text-sm ${className}`}
        style={{ color: 'var(--blossom-text-muted)' }}
        aria-hidden
      >
        Image failed to load
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
        aria-hidden
      />
    </div>
  );
}

export default FlowerAsciiDither;
