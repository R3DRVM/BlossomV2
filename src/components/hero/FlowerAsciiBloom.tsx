/**
 * Hero blossom: ASCII + ordered dither from blossomascii.jpg only.
 * Cave-in → unfold warp driven by progress. Transparent canvas; only glyphs drawn.
 * No still images (blossomstill*) drawn; they are reference only.
 */

import { useRef, useEffect, useCallback, useState } from 'react';

import blossomSrc from '@/assets/blossomascii.jpg';

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

const RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const MAX_FPS = 30;
const CELL_MIN = 6;
const CELL_MAX = 10;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface FlowerAsciiBloomProps {
  /** 0..1 scroll progress: 0 = caved inward, 1 = full bloom */
  progress: number;
  /** Light mode = dark glyphs on light; dark = light glyphs on dark */
  isDark?: boolean;
  className?: string;
}

export function FlowerAsciiBloom({ progress, isDark = false, className = '' }: FlowerAsciiBloomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const lastDrawRef = useRef(0);
  const timeRef = useRef(0);
  const hiddenRef = useRef(false);

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
          console.error('[FlowerAsciiBloom] Failed to process blossomascii.jpg', e);
        }
      }
    };
    img.onerror = () => {
      setLoadError(true);
      if (typeof console !== 'undefined' && console.error) {
        console.error('[FlowerAsciiBloom] Failed to load blossomascii.jpg');
      }
    };
    img.src = blossomSrc;
    return () => { sourceRef.current = null; };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || hiddenRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    if (now - lastDrawRef.current < 1000 / MAX_FPS) return;
    lastDrawRef.current = now;
    timeRef.current += 0.016;
    const t = timeRef.current;

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

    const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(Math.min(cssW, cssH) / 55)));
    const cols = Math.ceil(cssW / cell);
    const rows = Math.ceil(cssH / cell);

    const p = Math.max(0, Math.min(1, progress));
    const collapse = smoothstep(0, 0.55, 1 - p);
    const open = smoothstep(0.25, 1, p);

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

    ctx.clearRect(0, 0, cw, ch);

    const ramp = isDark ? RAMP.split('').reverse().join('') : RAMP;
    const ink = isDark ? 'rgba(248,248,252,0.92)' : 'rgba(18,18,24,0.92)';
    const pink =
      (typeof getComputedStyle !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--blossom-pink').trim()) || '#FF6BA0';
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    ctx.font = `${Math.max(6, cell - 1)}px "SF Mono", "Monaco", "Consolas", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const nx = (ix + 0.5) / cols;
        const ny = (iy + 0.5) / rows;
        const x = (nx - cx) * 2;
        const y = (ny - cy) * 2;
        let r = Math.sqrt(x * x + y * y);
        let a = Math.atan2(y, x);

        if (!reduced) {
          const rNorm = r;
          const collapseTerm = collapse * (0.22 * Math.sin(a * 6 + t * 0.6) + 0.1 * Math.sin(a * 12 - t * 0.3));
          r = r * (0.35 + 0.65 * open) + collapseTerm;
          a = a + (1 - open) * 0.35 * (1 - rNorm) * Math.sin(t * 0.4);
        }

        const u = cx + (r * Math.cos(a) / 2) * vw;
        const v = cy + (r * Math.sin(a) / 2) * vh;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;

        const sx = Math.floor(u * (sw - 1));
        const sy = Math.floor(v * (sh - 1));
        const si = (Math.max(0, Math.min(sh - 1, sy)) * sw + Math.max(0, Math.min(sw - 1, sx))) * 4;
        const R = data[si];
        const G = data[si + 1];
        const B = data[si + 2];
        const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;

        const bx = ix % 8;
        const by = iy % 8;
        const bayer = (BAYER_8X8[by * 8 + bx] + 0.5) / 64;
        const Ld = Math.max(0, Math.min(1, L + (L - bayer) * 0.4));

        const idx = Math.floor(Ld * (ramp.length - 1.001));
        const glyph = ramp[Math.max(0, idx)] ?? ' ';

        if (glyph === ' ') continue;

        const px = (nx * cssW) * dpr;
        const py = (ny * cssH) * dpr;
        const alpha = 0.85 + 0.15 * L;
        const usePink = isDark ? L > 0.7 : L > 0.75;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = usePink ? pink : ink;
        ctx.fillText(glyph, px, py);
      }
    }
    ctx.globalAlpha = 1;
  }, [progress, isDark]);

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
      <div className="flex items-center justify-center w-full h-full text-sm text-[var(--blossom-text-muted)]" aria-hidden>
        Image failed to load
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none block w-full h-full"
        style={{ display: 'block', background: 'transparent' }}
        aria-hidden
      />
    </div>
  );
}

export default FlowerAsciiBloom;
