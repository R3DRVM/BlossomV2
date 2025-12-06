import { Routes, Route, Navigate } from 'react-router-dom';
import BlossomAppShell from '../layouts/BlossomAppShell';

// Landing page will be imported here once created
// import LandingPage from '../pages/LandingPage';

export default function AppRouter() {
  return (
    <Routes>
      {/* Temporarily redirect / to /app until LandingPage is ready */}
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<BlossomAppShell />} />
    </Routes>
  );
}

