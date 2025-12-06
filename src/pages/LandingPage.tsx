/**
 * Landing Page
 * Identical to SuddenGreenCad Home.tsx structure, using Blossom's cherry blossom animation
 */

import { useNavigate } from 'react-router-dom';
import { Terminal, Shield, Zap, Brain, Activity, BarChart3, Globe, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { BlossomLogo } from '../components/BlossomLogo';
import { CherryBlossomBackground } from '../components/landing/CherryBlossomBackground';
import { HeroTerminal } from '../components/landing/HeroTerminal';

const Navigation = ({ navigate }: { navigate: (path: string) => void }) => (
  <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#E5E5E5]/40 bg-white/80 backdrop-blur-md">
    <div className="container mx-auto px-6 h-20 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <BlossomLogo size={32} className="drop-shadow-sm" />
        <span className="text-xl font-bold tracking-tight text-[#111111]" style={{
          fontFamily: '"Playfair Display", Georgia, serif',
        }}>
          Blossom
        </span>
      </div>

      <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#666666]">
        <a href="#features" className="hover:text-[#F25AA2] transition-colors">Capabilities</a>
        <a href="#engine" className="hover:text-[#F25AA2] transition-colors">ElizaOS Engine</a>
        <a href="#roadmap" className="hover:text-[#F25AA2] transition-colors">Roadmap</a>
      </div>

      <Button onClick={() => navigate('/app')} className="shadow-lg" style={{
        boxShadow: '0 4px 14px rgba(242, 90, 162, 0.2)',
      }}>
        Open App
      </Button>
    </div>
  </nav>
);

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <div className="group relative p-8 rounded-2xl border border-[#E5E5E5] bg-white/60 backdrop-blur-sm hover:shadow-xl hover:shadow-[#F25AA2]/5 hover:border-[#F25AA2]/20 transition-all duration-300">
    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity text-[#F25AA2]">
      <ArrowRight className="w-5 h-5 -rotate-45" />
    </div>
    <div className="w-12 h-12 rounded-lg bg-[#F25AA2]/5 flex items-center justify-center text-[#F25AA2] mb-6 group-hover:scale-110 transition-transform duration-300">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-xl font-bold mb-3 text-[#111111]" style={{
      fontFamily: '"Playfair Display", Georgia, serif',
    }}>
      {title}
    </h3>
    <p className="text-[#666666] leading-relaxed">
      {description}
    </p>
  </div>
);

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans relative overflow-x-hidden">
      {/* Use Blossom's existing cherry blossom background/animation */}
      <CherryBlossomBackground />

      <Navigation navigate={navigate} />

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden z-10">
        <div className="container mx-auto px-6 relative">
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            <Badge variant="outline" className="mb-6">
              Powered by ElizaOS V2
            </Badge>
            
            <h1
              className="text-5xl md:text-7xl font-medium leading-[1.1] tracking-tight mb-6 text-[#111111]"
              style={{
                fontFamily: '"Playfair Display", "DM Serif Display", Georgia, "Times New Roman", serif',
              }}
            >
              The Intelligent <br />
              <span className="text-[#F25AA2] italic">Execution Layer</span>
            </h1>
            
            <p className="text-lg md:text-xl text-[#666666] max-w-2xl mb-10 leading-relaxed bg-white/30 backdrop-blur-[2px] rounded-xl p-4">
              Your AI-native copilot for on-chain perps and DeFi. 
              Command strategy, execution, and risk management with natural language.
            </p>
            
            <div className="w-full max-w-xl mx-auto mt-12">
              <HeroTerminal />
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 relative bg-white/20 backdrop-blur-sm z-10">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[#111111]" style={{
              fontFamily: '"Playfair Display", Georgia, serif',
            }}>
              Engineered for Alpha
            </h2>
            <p className="text-[#666666] max-w-2xl mx-auto bg-white/40 backdrop-blur-[2px] rounded-lg p-2">
              Blossom translates your intent into precise on-chain execution, handling the complexities of DeFi while you focus on strategy.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={Brain}
              title="Intelligent Strategy"
              description="Describe your thesis in plain English. Blossom analyzes market structure, identifies setups, and validates entry criteria automatically."
            />
            <FeatureCard
              icon={Zap}
              title="Execution & Routing"
              description="Best-price execution across multiple AMMs and Perp DEXs. Smart routing minimizes slippage and maximizes capital efficiency."
            />
            <FeatureCard
              icon={Shield}
              title="Autonomous Risk"
              description="Set-and-forget risk parameters. Blossom monitors positions 24/7, managing liquidation risk and dynamic stop-losses."
            />
          </div>
        </div>
      </section>

      {/* Vision Section */}
      <section className="py-24 relative overflow-hidden z-10">
        <div className="container mx-auto px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="bg-white/30 backdrop-blur-sm rounded-3xl p-8">
              <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight text-[#111111]" style={{
                fontFamily: '"Playfair Display", Georgia, serif',
              }}>
                Trade Anything. <br />
                <span className="text-[#F25AA2]">Any Chain. Anywhere.</span>
              </h2>
              <div className="space-y-6 text-lg text-[#666666]">
                <p>
                  We envision Blossom as the universal interface for value exchange. Today, it's perps. Tomorrow, it's everything.
                </p>
                <ul className="space-y-3 mt-8">
                  {[
                    "Pre-IPO Companies",
                    "Event Contracts & Prediction Markets",
                    "Exotic Futures (Labubu, Sneakers, Art)",
                    "Cross-chain Arbitrage"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-[#111111]/80 font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#F25AA2]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Button variant="outline" className="mt-10 h-12 px-8 rounded-full text-[#111111] bg-white/50">
                Read the Vision Paper
              </Button>
            </div>

            <div className="relative">
              <div className="grid grid-cols-2 gap-4">
                <Card className="translate-y-8">
                  <Activity className="w-8 h-8 text-[#F25AA2] mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-[#111111]">$24.5M</div>
                  <div className="text-sm text-[#666666]">Volume Processed</div>
                </Card>
                <Card>
                  <Terminal className="w-8 h-8 text-blue-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-[#111111]">12ms</div>
                  <div className="text-sm text-[#666666]">Execution Latency</div>
                </Card>
                <Card className="translate-y-8">
                  <Globe className="w-8 h-8 text-purple-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-[#111111]">12</div>
                  <div className="text-sm text-[#666666]">Chains Supported</div>
                </Card>
                <Card>
                  <BarChart3 className="w-8 h-8 text-green-500 mb-4" />
                  <div className="text-2xl font-mono font-bold mb-1 text-[#111111]">99.9%</div>
                  <div className="text-sm text-[#666666]">Uptime</div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-[#E5E5E5] bg-white/80 backdrop-blur-md relative z-10">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <BlossomLogo size={24} />
            <span className="font-bold text-[#111111]" style={{
              fontFamily: '"Playfair Display", Georgia, serif',
            }}>
              Blossom
            </span>
          </div>
          
          <div className="text-sm text-[#666666]">
            © 2024 Blossom Protocol. Built with ElizaOS.
          </div>

          <div className="flex gap-6 text-sm text-[#666666]">
            <a href="#" className="hover:text-[#F25AA2] transition-colors">Twitter</a>
            <a href="#" className="hover:text-[#F25AA2] transition-colors">Discord</a>
            <a href="#" className="hover:text-[#F25AA2] transition-colors">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
