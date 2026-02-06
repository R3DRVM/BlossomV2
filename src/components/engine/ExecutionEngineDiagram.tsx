/**
 * Execution engine diagram: stacked 3D ring funnel (reference: engine.jpg / enginestill1–5).
 * Step 0 = beam; steps 1–6 = one ring each; step 5 = full funnel + orbit + petal flow.
 * Do NOT render enginestill*.png; they are shape references only.
 */

import React, { useMemo } from 'react';
import { EngineParticleFlow } from './EngineParticleFlow';

export type EngineStepId = 'intent' | 'routing' | 'execution' | 'risk' | 'validation' | 'learning';

export interface ExecutionEngineDiagramProps {
  /** 0 = beam only; 1..6 = add ring 1..6; 6 = full + orbit + markers + glow */
  activeStep: number;
  className?: string;
}

const CX = 160;
const CY = 180;
const RING_RADII = [28, 48, 68, 88, 108, 128];
const RING_THICKNESS = 14;
const PERSPECTIVE = 0.35;

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`;
}

function ringGroup(
  id: string,
  topY: number,
  r: number,
  thickness: number,
  label: string
) {
  const ryTop = r;
  const rxTop = r;
  const ryBottom = r * (1 - PERSPECTIVE);
  const rxBottom = r * 0.98;
  const bottomY = topY + thickness;
  const topPath = ellipsePath(CX, topY, rxTop, ryTop);
  const bottomPath = ellipsePath(CX, bottomY, rxBottom, ryBottom);
  const segments = 16;
  const connectors: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x1 = CX + rxTop * Math.cos(t);
    const y1 = topY + ryTop * Math.sin(t) * 0.4;
    const x2 = CX + rxBottom * Math.cos(t);
    const y2 = bottomY + ryBottom * Math.sin(t) * 0.4;
    connectors.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }
  return (
    <g id={id} data-engine-group={label} className="engine-ring transition-all duration-500">
      <path d={topPath} fill="none" stroke="var(--blossom-engine-stroke)" strokeWidth="2" opacity="1" />
      <path d={bottomPath} fill="none" stroke="var(--blossom-engine-stroke)" strokeWidth="1.2" opacity="0.85" />
      {connectors.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--blossom-engine-stroke)" strokeWidth="1" opacity="0.7" />
      ))}
    </g>
  );
}

export function ExecutionEngineDiagram({ activeStep, className = '' }: ExecutionEngineDiagramProps) {
  /** activeStep 0..5 from page: 0 = beam only, 1 = +ring1, ... 5 = all rings + orbit + markers */
  const isFinal = activeStep >= 5;
  const scale = isFinal ? 1.06 : 1;
  const beamVisible = activeStep >= 0;
  const beamOpacity = beamVisible ? (isFinal ? 0.9 : 0.7) : 0;

  const rings = useMemo(() => {
    const startY = CY - (RING_RADII.length * (RING_THICKNESS + 4)) / 2;
    return RING_RADII.map((r, i) =>
      ringGroup(`ring-${i + 1}`, startY + i * (RING_THICKNESS + 4), r, RING_THICKNESS, `ring-${i + 1}`)
    );
  }, []);

  const ringVisible = (ringIndex: number) => activeStep >= ringIndex + 1;
  const orbitVisible = activeStep >= 5;
  const markersVisible = activeStep >= 5;

  return (
    <div
      className={`engine-diagram flex items-center justify-center ${className}`}
      style={{ transform: `scale(${scale})` }}
      aria-hidden
    >
      <div className="relative w-full max-w-md">
        <svg
          viewBox="0 0 320 360"
          className="w-full h-auto block"
          style={{ filter: isFinal ? 'drop-shadow(0 0 24px var(--blossom-engine-glow))' : undefined }}
        >
        <defs>
          <linearGradient id="beam-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--blossom-engine-stroke)" stopOpacity={0} />
            <stop offset="50%" stopColor="var(--blossom-engine-stroke)" stopOpacity={beamOpacity} />
            <stop offset="100%" stopColor="var(--blossom-engine-stroke)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Step 0: center beam only */}
        <g id="center-beam" data-engine-group="center-beam" className="transition-all duration-500">
          <line
            x1={CX}
            y1={40}
            x2={CX}
            y2={320}
            stroke="url(#beam-grad)"
            strokeWidth={isFinal ? 6 : 4}
            opacity={beamVisible ? 1 : 0}
          />
        </g>
        {/* Steps 1–6: rings appear one by one */}
        {rings.map((ring, i) => (
          <g key={`ring-wrap-${i}`} style={{ opacity: ringVisible(i) ? 1 : 0 }} className="transition-opacity duration-500">
            {ring}
          </g>
        ))}
        {/* Step 6: orbit arrows */}
        <g
          id="orbit-arrows"
          data-engine-group="orbit-arrows"
          className="transition-all duration-500"
          style={{ opacity: orbitVisible ? 1 : 0 }}
        >
          <path
            d="M 60 180 A 100 80 0 0 1 260 180"
            fill="none"
            stroke="var(--blossom-engine-stroke)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <path
            d="M 260 180 A 100 80 0 0 1 60 180"
            fill="none"
            stroke="var(--blossom-engine-stroke)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </g>
        {/* Step 6: markers */}
        <g
          id="markers-nodes"
          data-engine-group="markers-nodes"
          className="transition-all duration-500"
          style={{ opacity: markersVisible ? 1 : 0 }}
        >
          {[80, 160, 240].map((x, i) => (
            <circle
              key={i}
              cx={x}
              cy={CY + 60}
              r={5}
              fill="var(--blossom-engine-fill)"
              stroke="var(--blossom-engine-stroke)"
              strokeWidth="1.5"
            />
          ))}
        </g>
      </svg>
        <EngineParticleFlow activeStep={activeStep} className="rounded" />
      </div>
    </div>
  );
}

export default ExecutionEngineDiagram;
