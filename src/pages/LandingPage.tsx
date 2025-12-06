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
        {/* Top Navigation - Premium sticky header */}
        <nav className="sticky top-0 w-full px-6 lg:px-10 py-4 flex items-center justify-between relative z-30 backdrop-blur-lg bg-white/95" style={{
          borderBottom: '1px solid #F3E5EC',
        }}>
          <div className="flex items-center gap-2">
            <BlossomLogo size={28} className="drop-shadow-sm" />
            <span className="text-lg font-semibold text-[#111111]">Blossom</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="text-sm text-[#444444] hover:text-[#111111] transition-colors">
              Docs
            </a>
            <button
              onClick={() => navigate('/app')}
              className="px-5 py-2.5 text-sm font-medium text-white bg-[#F25AA2] rounded-full hover:bg-[#FF4B8A] transition-all shadow-md hover:shadow-lg"
            >
              Open App
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

