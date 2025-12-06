/**
 * Landing Page
 * Premium landing page with cherry blossom aesthetic
 * Based on SuddenGreenCad reference design
 */

import { useNavigate } from 'react-router-dom';
import { BlossomLogo } from '../components/BlossomLogo';
import { CherryBlossomBackground } from '../components/landing/CherryBlossomBackground';
import { HeroSection } from '../components/landing/HeroSection';
import { FeatureSections } from '../components/FeatureSections';
import { LandingFooter } from '../components/LandingFooter';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans relative overflow-x-hidden">
      {/* Background layer */}
      <CherryBlossomBackground />

      {/* Navigation */}
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

          <button
            onClick={() => navigate('/app')}
            className="bg-[#F25AA2] hover:bg-[#F25AA2]/90 text-white rounded-full px-6 py-2.5 text-sm font-medium shadow-lg transition-all"
            style={{
              boxShadow: '0 4px 14px rgba(242, 90, 162, 0.2)',
            }}
          >
            Launch Terminal
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <HeroSection />

      {/* Feature Sections */}
      <FeatureSections />

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
