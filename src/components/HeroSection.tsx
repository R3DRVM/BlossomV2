import { useNavigate } from 'react-router-dom';
import { HeroTerminal } from './HeroTerminal';

export function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-[85vh] overflow-hidden py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Column - Text */}
          <div className="space-y-6 relative z-10">
            {/* Top pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#FFD6E6] bg-white/80 backdrop-blur-sm">
              <span className="text-xs font-medium text-[#F25AA2]">Blossom AI v1.0</span>
              <span className="text-xs text-[#999999]">·</span>
              <span className="text-xs text-[#666666]">SIM only · No real trades</span>
            </div>

            {/* Headline - Serif font, two-line style */}
            <h1 
              className="text-5xl md:text-6xl lg:text-7xl font-bold text-[#111111] leading-[1.1]"
              style={{ 
                fontFamily: '"Playfair Display", "DM Serif Display", Georgia, "Times New Roman", serif',
              }}
            >
              <div>The Intelligent</div>
              <div>
                <span className="bg-gradient-to-r from-[#F25AA2] via-[#FF7EB3] to-[#C29FFF] bg-clip-text text-transparent">
                  Execution Layer
                </span>
              </div>
            </h1>

            {/* Subheadline */}
            <p className="text-base md:text-lg text-[#3A3A3A] max-w-lg leading-relaxed">
              Your AI-native copilot for strategy, execution, and risk management. Command perp, DeFi, and prediction market strategies in plain English.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <button
                onClick={() => navigate('/app')}
                className="px-6 py-3 text-base font-medium text-white bg-[#F25AA2] rounded-full hover:bg-[#FF4B8A] transition-all shadow-md hover:shadow-lg"
              >
                Launch Terminal
              </button>
              <button
                onClick={() => {
                  console.log('View product deck');
                }}
                className="px-6 py-3 text-base font-medium text-[#111111] border border-[#F25AA2] rounded-full hover:bg-[#FFD6E6]/30 transition-all"
              >
                View product deck
              </button>
            </div>
          </div>

          {/* Right Column - Terminal Preview */}
          <div className="relative z-20">
            <HeroTerminal />
          </div>
        </div>
      </div>
    </section>
  );
}
