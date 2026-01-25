import { Routes, Route } from 'react-router-dom';
import BlossomAppShell from '../layouts/BlossomAppShell';
import LandingPage from '../pages/LandingPage';
import DevnetActivityPage from '../pages/DevnetActivityPage';
import DevLedgerPage from '../pages/DevLedgerPage';
import DevStatsPage from '../pages/DevStatsPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<BlossomAppShell />} />
      <Route path="/devnet" element={<DevnetActivityPage />} />
      <Route path="/dev/ledger" element={<DevLedgerPage />} />
      <Route path="/dev/stats" element={<DevStatsPage />} />
    </Routes>
  );
}

