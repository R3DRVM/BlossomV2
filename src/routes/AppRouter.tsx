import { Routes, Route } from 'react-router-dom';
import BlossomAppShell from '../layouts/BlossomAppShell';
import LandingPage from '../pages/LandingPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<BlossomAppShell />} />
    </Routes>
  );
}

