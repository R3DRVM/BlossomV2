/**
 * Landing Preview — Selecta-style layout.
 * Hero: FlowerAsciiDither (flower silhouette only, dither + scroll-driven bloom).
 * Engine: SVG diagram with step-by-step reveal. Dev slider for bloom tuning.
 */

import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { BlossomLogo } from '@/components/BlossomLogo';
import { FlowerAsciiDither } from '@/components/hero/FlowerAsciiDither';
import { ExecutionEngineDiagram } from '@/components/engine/ExecutionEngineDiagram';

const SCROLL_RANGE_VH = 60;
const ENGINE_STEPS = [
  { id: 'intent', num: '01', title: 'Intent', body: 'Blossom interprets your natural language into structured strategies, backed by market context and technical reasoning.' },
  { id: 'routing', num: '02', title: 'Routing', body: 'Capital flows to the highest-efficiency paths across AMMs, perp DEXs, and prediction markets. Smart routing minimizes slippage.' },
  { id: 'execution', num: '03', title: 'Execution', body: 'AI-native execution layer for on-chain perps and DeFi. Command strategy and execution with natural language.' },
  { id: 'risk', num: '04', title: 'Risk', body: 'Set-and-forget risk parameters. Blossom monitors positions with dynamic liquidation alerts and automated hedge protection.' },
  { id: 'validation', num: '05', title: 'Validation', body: 'Full auditability and clear ownership. Submit, track, and approve requests across teams with precision.' },
  { id: 'learning', num: '06', title: 'Learning', body: 'AI is the primary operator inside the workflow. This is not automation added to execution — it is execution rebuilt so intelligence runs the system.' },
];

function useScrollProgress(scrollRangeVh: number) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const range = (scrollRangeVh / 100) * vh;
      setProgress(Math.max(0, Math.min(1, (window.scrollY ?? 0) / range)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollRangeVh]);
  return progress;
}

function useEngineStep(sectionRef: React.RefObject<HTMLElement | null>, stepRefs: React.RefObject<HTMLElement | null>[]) {
  const [activeStep, setActiveStep] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      if (!sectionRef.current) return;
      const viewportMid = window.innerHeight * 0.4;
      for (let i = stepRefs.length - 1; i >= 0; i--) {
        const el = stepRefs[i].current;
        if (el && el.getBoundingClientRect().top <= viewportMid) {
          setActiveStep(i);
          return;
        }
      }
      if (sectionRef.current.getBoundingClientRect().top > viewportMid) setActiveStep(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [sectionRef, stepRefs]);
  return activeStep;
}

export default function LandingPreviewSelecta() {
  const navigate = useNavigate();
  const scrollProgress = useScrollProgress(SCROLL_RANGE_VH);
  const [devSlider, setDevSlider] = useState(false);
  const [devProgress, setDevProgress] = useState(0.5);
  const bloomProgress = devSlider ? devProgress : scrollProgress;

  const engineSectionRef = useRef<HTMLElement>(null);
  const stepRef0 = useRef<HTMLDivElement>(null);
  const stepRef1 = useRef<HTMLDivElement>(null);
  const stepRef2 = useRef<HTMLDivElement>(null);
  const stepRef3 = useRef<HTMLDivElement>(null);
  const stepRef4 = useRef<HTMLDivElement>(null);
  const stepRef5 = useRef<HTMLDivElement>(null);
  const stepRefs = [stepRef0, stepRef1, stepRef2, stepRef3, stepRef4, stepRef5];
  const activeStep = useEngineStep(engineSectionRef, stepRefs);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('blossom-landing-theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('blossom-landing-theme', theme);
  }, [theme]);

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: 'var(--blossom-bg)',
        color: 'var(--blossom-text)',
        backgroundImage: 'var(--blossom-bg-pattern)',
        backgroundSize: theme === 'light' ? '24px 24px' : '32px 32px',
      }}
    >
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-md"
        style={{ borderColor: 'var(--blossom-border)', backgroundColor: 'var(--blossom-nav-bg)' }}
      >
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BlossomLogo size={32} className="drop-shadow-sm" />
            <span className="text-xl font-bold tracking-tight" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Blossom</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: 'var(--blossom-text-muted)' }}>
            <a href="#capabilities">Capabilities</a>
            <a href="/stats">Statistics</a>
            <a href="/whitepaper">Whitepaper</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              className="rounded-full p-2 border text-sm"
              style={{ borderColor: 'var(--blossom-border)', color: 'var(--blossom-text-muted)' }}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <Button variant="outline" onClick={() => navigate('/app')} style={{ borderColor: 'var(--blossom-border)', color: 'var(--blossom-text)' }}>Login</Button>
            <Button onClick={() => navigate('/app')}>Open App</Button>
          </div>
        </div>
      </nav>

      {/* Hero: full-width flower silhouette behind headline (Selecta layout) */}
      <section className="relative min-h-[90vh] flex flex-col overflow-hidden">
        <div className="absolute inset-0 z-0" aria-hidden>
          <FlowerAsciiDither scrollProgress={bloomProgress} className="absolute inset-0 w-full h-full" />
        </div>
        <div className="container mx-auto px-6 max-w-4xl relative z-10 flex flex-col items-center justify-center text-center flex-1 pt-28 pb-16">
          <div className="bg-[var(--blossom-bg)]/80 backdrop-blur-sm rounded-2xl px-6 py-4 md:px-8 md:py-6 shadow-[0_0_40px_rgba(0,0,0,0.06)]">
            <h1
              className="text-4xl md:text-6xl font-medium leading-[1.15] tracking-tight mb-4 text-[var(--blossom-text)]"
              style={{ fontFamily: '"Playfair Display", Georgia, serif', textShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
            >
              The Intelligent <span className="italic" style={{ color: 'var(--blossom-pink)' }}>Execution Layer</span>
            </h1>
            <p className="text-lg md:text-xl mb-8 max-w-2xl" style={{ color: 'var(--blossom-text-muted)' }}>
              Your AI-native copilot for on-chain perps and DeFi. Command strategy, execution, and risk management with natural language.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button onClick={() => navigate('/app')}>Open App</Button>
              <Button variant="outline" onClick={() => navigate('/app')} style={{ borderColor: 'var(--blossom-border)', color: 'var(--blossom-text)' }}>Try Demo</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="py-12 border-t border-b" style={{ borderColor: 'var(--blossom-border)' }}>
        <div className="container mx-auto px-6">
          <p className="text-center text-sm uppercase tracking-wider mb-8" style={{ color: 'var(--blossom-text-muted)' }}>Trusted by industry leaders</p>
          <div className="flex flex-wrap justify-center gap-10 opacity-60" style={{ color: 'var(--blossom-text-muted)' }}>
            {['Blossom', 'ElizaOS', 'DeFi', 'Protocol', 'Partners', 'Ecosystem'].map((label) => <span key={label} className="text-sm font-medium">{label}</span>)}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="capabilities" className="py-24">
        <div className="container mx-auto px-6">
          <div className="mb-12">
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--blossom-text-muted)' }}>Benefits</p>
            <h2 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Join modern teams managing AI operations with confidence</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { label: 'Intent', title: 'Intent Understanding', body: 'Blossom translates natural language instructions into structured strategies, backed by market context and technical reasoning.' },
              { label: 'Execution', title: 'Optimized Execution', body: 'Capital flows to the highest-efficiency paths across AMMs, perp DEXs, and prediction markets. Smart routing minimizes slippage and maximizes capital efficiency.' },
              { label: 'Risk', title: 'Risk Controls', body: 'Set-and-forget risk parameters. Blossom monitors positions with dynamic liquidation alerts, volatility adjustments, and automated hedge protection before risk materializes.' },
            ].map(({ label, title, body }) => (
              <div key={title} className="rounded-2xl border p-6 transition-all hover:shadow-lg" style={{ borderColor: 'var(--blossom-border)', backgroundColor: 'var(--blossom-card-bg)' }}>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: 'var(--blossom-text-muted)' }}>{label}</p>
                <h3 className="text-xl font-bold mb-3" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--blossom-text-muted)' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Engine: left steps, right sticky SVG */}
      <section ref={engineSectionRef} className="py-24 relative">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className="space-y-16">
              {ENGINE_STEPS.map((step, i) => (
                <div key={step.id} ref={stepRefs[i] as React.RefObject<HTMLDivElement>} className="scroll-mt-32 transition-opacity" style={{ opacity: activeStep === i ? 1 : 0.6 }}>
                  <span className="text-4xl font-bold block mb-2" style={{ color: 'var(--blossom-pink)' }}>{step.num}</span>
                  <h3 className="text-2xl font-bold mb-4" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{step.title}</h3>
                  <p className="text-base leading-relaxed" style={{ color: 'var(--blossom-text-muted)' }}>{step.body}</p>
                </div>
              ))}
            </div>
            <div className="lg:sticky lg:top-24 flex justify-center items-start">
              <ExecutionEngineDiagram activeStep={activeStep} className="w-full max-w-xl" />
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t" style={{ borderColor: 'var(--blossom-border)' }}>
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <BlossomLogo size={24} />
            <span className="font-bold" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Blossom</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--blossom-text-muted)' }}>© 2024 Blossom Protocol. Built with ElizaOS.</p>
        </div>
      </footer>

      {/* Dev-only: Bloom Progress slider (bottom-left) */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-1 rounded-lg border bg-black/80 p-3 text-white shadow-lg">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={devSlider} onChange={(e) => setDevSlider(e.target.checked)} />
            Bloom Progress override
          </label>
          {devSlider && (
            <>
              <input
                type="range"
                min={0}
                max={100}
                value={devProgress * 100}
                onChange={(e) => setDevProgress(Number(e.target.value) / 100)}
                className="w-32"
              />
              <span className="text-xs">{(devProgress * 100).toFixed(0)}%</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
