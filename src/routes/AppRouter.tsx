import { Routes, Route } from 'react-router-dom';
import BlossomAppShell from '../layouts/BlossomAppShell';
import LandingPage from '../pages/LandingPage';
import LandingPreviewSelecta from '../pages/LandingPreviewSelecta';
import DevnetActivityPage from '../pages/DevnetActivityPage';
import DevLedgerPage from '../pages/DevLedgerPage';
import DevStatsPage from '../pages/DevStatsPage';
import WhitepaperPage from '../pages/WhitepaperPage';

/**
 * Detect which subdomain we're on for routing
 */
function getSubdomain(): string | null {
  if (typeof window === 'undefined') return null;

  const hostname = window.location.hostname;

  // Handle localhost (no subdomain detection)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  // Handle blossom.onl subdomains
  if (hostname.endsWith('.blossom.onl')) {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      return parts[0]; // e.g., 'app', 'stats', 'whitepaper'
    }
  }

  return null;
}

export default function AppRouter() {
  const subdomain = getSubdomain();

  // Route based on subdomain
  if (subdomain === 'stats') {
    // stats.blossom.onl → Public stats dashboard
    return (
      <Routes>
        <Route path="*" element={<DevStatsPage isPublic />} />
      </Routes>
    );
  }

  if (subdomain === 'whitepaper') {
    // whitepaper.blossom.onl → Whitepaper
    return (
      <Routes>
        <Route path="*" element={<WhitepaperPage />} />
      </Routes>
    );
  }

  if (subdomain === 'app') {
    // app.blossom.onl → Gated app
    return (
      <Routes>
        <Route path="*" element={<BlossomAppShell />} />
      </Routes>
    );
  }

  // Default routes (main domain or localhost)
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing-preview" element={<LandingPreviewSelecta />} />
      <Route path="/app" element={<BlossomAppShell />} />
      <Route path="/whitepaper" element={<WhitepaperPage />} />
      <Route path="/stats" element={<DevStatsPage isPublic />} />
      <Route path="/devnet" element={<DevnetActivityPage />} />
      <Route path="/dev/ledger" element={<DevLedgerPage />} />
      <Route path="/dev/stats" element={<DevStatsPage />} />
    </Routes>
  );
}
