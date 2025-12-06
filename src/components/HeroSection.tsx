import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatSimulation } from './ChatSimulation';

// Rotating words for the headline - can be easily updated here
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
    <section className="relative min-h-screen overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 lg:py-16 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[80vh]">
          {/* Left Column - Copy */}
          <div className="space-y-6">
            {/* Eyebrow pill */}
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-pink-200 bg-white/80 backdrop-blur-sm shadow-sm">
              <span className="text-xs font-medium text-blossom-pink">● Blossom AI v1.0</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500">SIM only · No real trades</span>
            </div>

            {/* Main headline with rotating word */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#1A1A1A] leading-tight">
              The intelligent execution layer for{' '}
              <span className="relative inline-block min-w-[200px]">
                <span
                  className={`inline-block transition-opacity duration-300 ${
                    isVisible ? 'opacity-100' : 'opacity-0'
                  } bg-gradient-to-r from-blossom-pink via-pink-500 to-rose-400 bg-clip-text text-transparent`}
                >
                  {ROTATING_WORDS[currentWordIndex]}
                </span>
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg text-slate-600 leading-relaxed max-w-lg">
              Your AI-native copilot for strategy, execution, and risk. Trade any asset on any venue with simple natural-language commands.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                onClick={() => navigate('/app')}
                className="px-6 py-3 text-sm font-medium text-white bg-blossom-pink rounded-full hover:bg-[#FF4B9A] transition-all shadow-lg hover:shadow-xl"
              >
                Open Blossom SIM
              </button>
              <button
                onClick={() => {
                  // Placeholder for product deck
                  console.log('View product deck');
                }}
                className="px-6 py-3 text-sm font-medium text-[#1A1A1A] border border-slate-300 rounded-full hover:bg-slate-50 transition-all"
              >
                View product deck
              </button>
            </div>
          </div>

          {/* Right Column - Chat Simulation */}
          <div className="relative">
            <ChatSimulation />
          </div>
        </div>
      </div>
    </section>
  );
}

