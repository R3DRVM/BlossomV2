import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ROTATING_WORDS = [
  'Pre-IPO',
  'Live Assets',
  'Stocks',
  'Crypto',
  'Prediction Markets',
  'Sports Markets',
];

export function HeroSection() {
  const navigate = useNavigate();
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setCurrentWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
        setIsVisible(true);
      }, 300); // Fade out duration
    }, 3000); // Change word every 3 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen landing-bg overflow-hidden">
      {/* Subtle cherry blossom background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 right-10 w-32 h-32 opacity-10">
          <div className="blossom-petal w-full h-full bg-blossom-pink rounded-full blur-2xl" />
        </div>
        <div className="absolute bottom-40 left-20 w-24 h-24 opacity-10" style={{ animationDelay: '2s' }}>
          <div className="blossom-petal w-full h-full bg-blossom-pink rounded-full blur-xl" />
        </div>
        <div className="absolute top-1/2 right-1/4 w-20 h-20 opacity-10" style={{ animationDelay: '4s' }}>
          <div className="blossom-petal w-full h-full bg-blossom-pink rounded-full blur-lg" />
        </div>
      </div>

      {/* Radial gradient overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,107,160,0.08),transparent_70%)]" />

      <div className="container mx-auto px-6 py-20 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[80vh]">
          {/* Left Column - Copy */}
          <div className="space-y-6">
            {/* Eyebrow pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blossom-pink/30 bg-white/60 backdrop-blur-sm">
              <span className="text-xs font-medium text-blossom-pink">Blossom AI v1.0</span>
              <span className="text-xs text-blossom-slate">·</span>
              <span className="text-xs text-blossom-slate">SIM only</span>
            </div>

            {/* Main headline with rotating word */}
            <h1 className="text-5xl lg:text-6xl font-bold text-blossom-ink leading-tight">
              The intelligent execution layer for{' '}
              <span className="relative inline-block min-w-[200px]">
                <span
                  className={`inline-block transition-opacity duration-300 ${
                    isVisible ? 'opacity-100' : 'opacity-0'
                  } bg-gradient-to-r from-blossom-pink to-pink-600 bg-clip-text text-transparent`}
                >
                  {ROTATING_WORDS[currentWordIndex]}
                </span>
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl text-blossom-slate leading-relaxed max-w-lg">
              Your AI-native copilot for strategy, execution, and risk. Trade any asset on any chain or venue with simple natural-language commands.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                onClick={() => navigate('/app')}
                className="px-6 py-3 text-base font-medium text-white bg-blossom-pink rounded-full hover:bg-blossom-pink/90 transition-all shadow-lg hover:shadow-xl"
              >
                Open Blossom SIM
              </button>
              <button
                onClick={() => {
                  // Placeholder for product deck
                  console.log('View product deck');
                }}
                className="px-6 py-3 text-base font-medium text-blossom-ink bg-white/80 backdrop-blur-sm rounded-full hover:bg-white transition-all border border-blossom-outline/50"
              >
                View product deck
              </button>
            </div>
          </div>

          {/* Right Column - Agent Terminal (placeholder for Phase 4) */}
          <div className="relative">
            <div className="landing-card p-8 min-h-[400px] flex items-center justify-center">
              <p className="text-blossom-slate text-center">
                Agent Terminal<br />
                <span className="text-sm">Coming in Phase 4</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

