import { useNavigate } from 'react-router-dom';
import { BlossomLogo } from '../components/BlossomLogo';
import { CherryBlossomBackground } from '../components/CherryBlossomBackground';
import { HeroSection } from '../components/HeroSection';
import { FeatureSections } from '../components/FeatureSections';
import { LandingFooter } from '../components/LandingFooter';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Fixed background */}
      <CherryBlossomBackground />

      {/* Foreground content */}
      <div className="relative z-10 flex flex-col">
        {/* Top Navigation */}
        <nav className="w-full px-6 lg:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BlossomLogo size={28} className="drop-shadow-sm" />
            <span className="text-lg font-semibold text-[#1A1A1A]">Blossom</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="text-sm text-slate-600 hover:text-[#1A1A1A] transition-colors">
              Docs
            </a>
            <button
              onClick={() => navigate('/app')}
              className="px-4 py-2 text-sm font-medium text-white bg-blossom-pink rounded-full hover:bg-[#FF4B9A] transition-colors shadow-sm"
            >
              Open SIM app
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
    </div>
  );
}

