/**
 * Hero Section
 * Two-line serif headline with chat preview
 * Based on SuddenGreenCad reference design
 */

import { ChatPreview } from './ChatPreview';

export function HeroSection() {

  return (
    <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden z-10">
      <div className="container mx-auto px-6 relative">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
          {/* Badge */}
          <div className="mb-6 border border-[#F25AA2]/30 text-[#F25AA2] bg-white/80 px-4 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm shadow-sm">
            Powered by ElizaOS V2
          </div>

          {/* Two-line serif headline */}
          <h1
            className="text-5xl md:text-7xl font-medium leading-[1.1] tracking-tight mb-6 text-[#111111]"
            style={{
              fontFamily: '"Playfair Display", "DM Serif Display", Georgia, "Times New Roman", serif',
            }}
          >
            The Intelligent <br />
            <span className="text-[#F25AA2] italic">Execution Layer</span>
          </h1>

          {/* Supporting text */}
          <p className="text-lg md:text-xl text-[#444444] max-w-2xl mb-10 leading-relaxed">
            Your AI-native copilot for on-chain perps and DeFi. Command strategy, execution, and risk management with natural language.
          </p>

          {/* Terminal Preview */}
            <div className="w-full max-w-xl mx-auto mt-12">
              <ChatPreview />
            </div>
        </div>
      </div>
    </section>
  );
}

