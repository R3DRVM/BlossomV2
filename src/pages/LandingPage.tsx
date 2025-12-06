import { useNavigate } from 'react-router-dom';
import { BlossomLogo } from '../components/BlossomLogo';
import { HeroSection } from '../components/HeroSection';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen landing-bg">
      {/* Top Navigation */}
      <nav className="w-full px-6 py-4 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-2">
          <BlossomLogo size={28} className="drop-shadow-sm" />
          <span className="text-lg font-semibold text-blossom-ink">Blossom</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#" className="text-sm text-blossom-slate hover:text-blossom-ink transition-colors">
            Docs
          </a>
          <button
            onClick={() => navigate('/app')}
            className="px-4 py-2 text-sm font-medium text-white bg-blossom-pink rounded-full hover:bg-blossom-pink/90 transition-colors shadow-sm"
          >
            Open SIM app
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <HeroSection />
    </div>
  );
}

