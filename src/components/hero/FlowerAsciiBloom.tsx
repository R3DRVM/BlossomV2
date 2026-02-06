/**
 * Hero blossom: tight dither-dot bloom from blossomascii.jpg only.
 * Pink-only shading; auto breathing (open→close→open) or manual progress.
 *
 * BLANK DEBUG NOTE: If the hero was blank, possible causes are: (1) canvas had 0 size
 * because the parent had no height at first paint; (2) component not mounted when
 * resize ran; (3) z-index or stacking context hiding the canvas; (4) early returns
 * (no src/bbox or image not ready) before any draw. The canary (DEBUG_CANARY) proves
 * whether the canvas is drawing and has size—if you see the canary, the issue was
 * image/ink logic; if not, layout or mount order.
 */
const DEBUG_CANARY = true;

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

const RAMP = ' ·•●';
const MAX_FPS = 30;
const INK_SKIP = 0.14;
const INK_SKIP_FALLBACK = 0.1;
const INK_NORMALIZE = 0.55;
const DITHER_STRENGTH = 0.45;
const DRAWN_LOW_THRESHOLD = 200;
const PETAL_COUNT = 5;
const CX = 0.5;
const CY = 0.6;
const ZOOM = 1.1;

const APERTURE = [0.12, 0.18, 0.26, 0.36, 0.48, 0.6, 0.72, 0.84, 0.96];
const LOBESHARP = [0.95, 0.92, 0.88, 0.82, 0.74, 0.66, 0.58, 0.5, 0.44];
const EDGE = [0.22, 0.2, 0.18, 0.16, 0.14, 0.12, 0.1, 0.09, 0.08];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  t = clamp01(t);
  const r = Math.round(lerp(A.r, B.r, t));
  const g = Math.round(lerp(A.g, B.g, t));
  const b2 = Math.round(lerp(A.b, B.b, t));
  return `rgb(${r}, ${g}, ${b2})`;
}

function pinkShade(t: number): string {
  const light = '#F7C6D9';
  const mid = '#EA86B7';
  const dark = '#C94A8F';
  const tt = Math.pow(clamp01(t), 0.75);
  if (tt < 0.6) return mixHex(light, mid, tt / 0.6);
  return mixHex(mid, dark, (tt - 0.6) / 0.4);
}

function inkFromRGB(r: number, g: number, b: number) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const chroma = maxc - minc;
  const pinkness = r - (g + b) * 0.5;
  const notWhite = (255 - luma) / 255;
  const ink = Math.max(
    0,
    (chroma / 255) * 0.55 + (pinkness / 255) * 0.8 + notWhite * 0.35
  );
  return { ink, luma, chroma, pinkness };
}

function computeBBoxFromImageData(
  img: ImageData,
  inkSkip = 0.14,
  step = 2
): { x: number; y: number; w: number; h: number } {
  const { data, width, height } = img;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { ink } = inkFromRGB(r, g, b);

      if (ink > inkSkip) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };

  const pad = Math.floor(Math.min(width, height) * 0.02);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export interface FlowerAsciiBloomProps {
  /** When provided, use this progress and do not run internal animation (e.g. dev override) */
  progress?: number;
  /** 'auto' = breathing loop; 'manual' = use progress only */
  mode?: 'auto' | 'manual';
  /** Loop duration in seconds (open→close→open) */
  loopSeconds?: number;
  /** Draw scale 0.65–0.95; flower fits in hero */
  scale?: number;
  palette?: 'pink';
  direction?: 'open-to-fold' | 'fold-to-open';
  isDark?: boolean;
  className?: string;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function FlowerAsciiBloom({
  progress: progressProp,
  mode = 'auto',
  loopSeconds = 7,
  scale: scaleProp = 0.9,
  palette = 'pink',
  direction = 'open-to-fold',
  isDark = false,
  className = '',
}: FlowerAsciiBloomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const bboxRef = useRef<BBox | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [autoP, setAutoP] = useState(1);
  const lastDrawRef = useRef(0);
  const hiddenRef = useRef(false);

  useEffect(() => {
    if (progressProp !== undefined) return;
    if (mode !== 'auto') return;
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
    if (media && media.matches) return;

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const dur = Math.max(2, loopSeconds) * 1000;
      const t = ((now - start) % dur) / dur;
      const tri = t < 0.5 ? t * 2 : 2 - t * 2;
      setAutoP(easeInOutCubic(tri));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressProp, mode, loopSeconds]);

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
        imageDataRef.current = id;
        bboxRef.current = computeBBoxFromImageData(id, INK_SKIP, 2);
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
    return () => {
      sourceRef.current = null;
      imageDataRef.current = null;
      bboxRef.current = null;
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (hiddenRef.current) return;

    const now = performance.now();
    if (now - lastDrawRef.current < 1000 / MAX_FPS) return;
    lastDrawRef.current = now;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    let cw = canvas.width;
    let ch = canvas.height;
    const container = containerRef.current;
    if ((cw === 0 || ch === 0) && container) {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      cw = canvas.width;
      ch = canvas.height;
    }
    let cssW = cw / dpr;
    let cssH = ch / dpr;
    if (cssW < 1 || cssH < 1) {
      cssW = Math.max(400, cssW);
      cssH = Math.max(300, cssH);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255, 0, 200, 0.25)';
    ctx.fillRect(20, 20, 200, 120);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.font = '24px system-ui';
    ctx.fillText('BLOOM CANARY', 30, 60);

    if (typeof console !== 'undefined' && console.log) {
      console.log('[FlowerAsciiBloom] draw tick', {
        cssW,
        cssH,
        dpr,
        canvasW: canvas.width,
        canvasH: canvas.height,
      });
    }

    if (DEBUG_CANARY) {
      ctx.fillStyle = 'rgba(230, 106, 163, 0.22)';
      for (let y = 0; y < cssH; y += 6) {
        for (let x = 0; x < cssW; x += 6) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    const src = sourceRef.current;
    const bbox = bboxRef.current;
    if (!src || !bbox) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    const { data, w: sw, h: sh } = src;
    if (!data?.length || sw < 1 || sh < 1) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FlowerAsciiBloom] image not ready', { sw, sh, dataLen: data?.length ?? 0 });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    if (cssW < 10 || cssH < 10) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FlowerAsciiBloom] canvas too small', { cssW, cssH });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const open = progressProp ?? autoP;
    const rawP = reduced ? 1 : clamp01(open);
    const p = direction === 'open-to-fold' ? rawP : 1 - rawP;
    const stage = Math.min(8, Math.floor(p * 8.999));
    const tStage = clamp01((p * 8) - stage);
    const apertureRadius = APERTURE[stage] + tStage * (APERTURE[stage + 1] - APERTURE[stage]);
    const lobeSharp = LOBESHARP[stage] + tStage * (LOBESHARP[stage + 1] - LOBESHARP[stage]);
    const edgeSoft = EDGE[stage] + tStage * (EDGE[stage + 1] - EDGE[stage]);

    const s = Math.max(0.75, Math.min(0.98, scaleProp ?? 0.9));
    let drawW = Math.floor(cssW * s);
    let drawH = Math.floor(cssH * s);
    let ox = Math.floor((cssW - drawW) / 2);
    let oy = Math.floor((cssH - drawH) / 2);
    if (drawW < 10 || drawH < 10) {
      drawW = Math.floor(cssW);
      drawH = Math.floor(cssH);
      ox = 0;
      oy = 0;
    }

    const CELL = dpr >= 2 ? 2 : 3;
    const cols = Math.ceil(drawW / CELL);
    const rows = Math.ceil(drawH / CELL);
    const radiusCSS = 1.2;
    const aspectBbox = bbox.w / bbox.h;
    const aspectView = drawW / drawH;
    const rMax = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);

    function runPass(inkSkip: number): number {
      let drawn = 0;
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          const nx = (ix + 0.5) / cols;
          const ny = (iy + 0.5) / rows;
          const dx = nx - CX;
          const dy = ny - CY;
          const rNorm = Math.sqrt(dx * dx + dy * dy) / rMax;
          const theta = Math.atan2(dy, dx);

          const lobe = Math.cos(PETAL_COUNT * theta);
          const lobeMask = 0.3 + 0.7 * Math.pow(Math.max(0, Math.abs(lobe)), lobeSharp);
          const apertureMask = lobeMask * (1 - smoothstep(apertureRadius - edgeSoft, apertureRadius + edgeSoft, rNorm));
          if (apertureMask < 0.06) continue;

          let u: number;
          let v: number;
          if (aspectView >= aspectBbox) {
            u = (nx - 0.5 + aspectBbox / 2) / aspectBbox;
            v = ny;
          } else {
            u = nx;
            v = (ny - 0.5 + 0.5 / aspectBbox) * aspectBbox;
          }
          const uContent = (u - 0.5) / ZOOM + 0.5;
          const vContent = (v - 0.5) / ZOOM + 0.5;
          if (uContent < 0 || uContent > 1 || vContent < 0 || vContent > 1) continue;

          const srcX = Math.max(0, Math.min(sw - 1, Math.floor(bbox!.x + uContent * (bbox!.w - 1))));
          const srcY = Math.max(0, Math.min(sh - 1, Math.floor(bbox!.y + vContent * (bbox!.h - 1))));
          const si = (srcY * sw + srcX) * 4;
          const R = data[si];
          const G = data[si + 1];
          const B = data[si + 2];
          const { ink } = inkFromRGB(R, G, B);

          if (ink <= inkSkip) continue;

          const bx = ix % 8;
          const by = iy % 8;
          const bayer = (BAYER_8X8[by * 8 + bx] + 0.5) / 64;
          const inkNorm = clamp01((ink - inkSkip) / INK_NORMALIZE);
          const Ld = clamp01(inkNorm + (inkNorm - bayer) * DITHER_STRENGTH);
          const dotAlpha = (1 - Ld) * apertureMask;
          if (dotAlpha < 0.08) continue;

          const t = clamp01((ink - inkSkip) / INK_NORMALIZE);
          let alpha = Math.min(0.7, 0.08 + t * 0.55);
          alpha = alpha * dotAlpha;

          const px = ox + nx * drawW;
          const py = oy + ny * drawH;
          ctx!.fillStyle = pinkShade(t);
          ctx!.globalAlpha = alpha;
          if (CELL <= 2) {
            ctx!.fillRect(px, py, 2, 2);
          } else {
            ctx!.beginPath();
            ctx!.arc(px, py, radiusCSS, 0, Math.PI * 2);
            ctx!.fill();
          }
          drawn++;
        }
      }
      return drawn;
    }

    let drawn = runPass(INK_SKIP);
    if (drawn < DRAWN_LOW_THRESHOLD) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FlowerAsciiBloom] drawn too low', {
          drawn,
          cssW,
          cssH,
          drawW,
          drawH,
          cell: CELL,
          open,
        });
      }
      ctx.clearRect(0, 0, cssW, cssH);
      drawW = Math.floor(cssW);
      drawH = Math.floor(cssH);
      ox = 0;
      oy = 0;
      const colsFallback = Math.ceil(drawW / CELL);
      const rowsFallback = Math.ceil(drawH / CELL);
      drawn = 0;
      for (let iy = 0; iy < rowsFallback; iy++) {
        for (let ix = 0; ix < colsFallback; ix++) {
          const nx = (ix + 0.5) / colsFallback;
          const ny = (iy + 0.5) / rowsFallback;
          const dx = nx - CX;
          const dy = ny - CY;
          const rNorm = Math.sqrt(dx * dx + dy * dy) / rMax;
          const theta = Math.atan2(dy, dx);
          const lobe = Math.cos(PETAL_COUNT * theta);
          const lobeMask = 0.3 + 0.7 * Math.pow(Math.max(0, Math.abs(lobe)), lobeSharp);
          const apertureMask = lobeMask * (1 - smoothstep(apertureRadius - edgeSoft, apertureRadius + edgeSoft, rNorm));
          if (apertureMask < 0.06) continue;
          const aspectViewF = drawW / drawH;
          let u: number;
          let v: number;
          if (aspectViewF >= aspectBbox) {
            u = (nx - 0.5 + aspectBbox / 2) / aspectBbox;
            v = ny;
          } else {
            u = nx;
            v = (ny - 0.5 + 0.5 / aspectBbox) * aspectBbox;
          }
          const uContent = (u - 0.5) / ZOOM + 0.5;
          const vContent = (v - 0.5) / ZOOM + 0.5;
          if (uContent < 0 || uContent > 1 || vContent < 0 || vContent > 1) continue;
          const srcX = Math.max(0, Math.min(sw - 1, Math.floor(bbox!.x + uContent * (bbox!.w - 1))));
          const srcY = Math.max(0, Math.min(sh - 1, Math.floor(bbox!.y + vContent * (bbox!.h - 1))));
          const si = (srcY * sw + srcX) * 4;
          const { ink } = inkFromRGB(data[si], data[si + 1], data[si + 2]);
          if (ink <= INK_SKIP_FALLBACK) continue;
          const bx = ix % 8;
          const by = iy % 8;
          const bayer = (BAYER_8X8[by * 8 + bx] + 0.5) / 64;
          const inkNorm = clamp01((ink - INK_SKIP_FALLBACK) / INK_NORMALIZE);
          const Ld = clamp01(inkNorm + (inkNorm - bayer) * DITHER_STRENGTH);
          const dotAlpha = (1 - Ld) * apertureMask;
          if (dotAlpha < 0.08) continue;
          const t = clamp01((ink - INK_SKIP_FALLBACK) / INK_NORMALIZE);
          let alpha = Math.min(0.7, 0.08 + t * 0.55) * dotAlpha;
          const px = ox + nx * drawW;
          const py = oy + ny * drawH;
          ctx!.fillStyle = pinkShade(t);
          ctx!.globalAlpha = alpha;
          if (CELL <= 2) {
            ctx!.fillRect(px, py, 2, 2);
          } else {
            ctx!.beginPath();
            ctx!.arc(px, py, radiusCSS, 0, Math.PI * 2);
            ctx!.fill();
          }
          drawn++;
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [progressProp, autoP, direction, scaleProp]);

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
    <div
      ref={containerRef}
      className={`w-full h-full min-h-[400px] ${className}`}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          opacity: 1,
          pointerEvents: 'none',
          display: 'block',
          background: 'transparent',
        }}
        aria-hidden
      />
    </div>
  );
}

export default FlowerAsciiBloom;
