import { BlossomProvider } from '../context/BlossomContext';
import CopilotLayout from '../components/CopilotLayout';

function AppContent() {
  return (
    <div className="min-h-screen w-full bg-slate-50">
      {/* Stable subtle blossom bloom gradient - does not change on tab switch */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.16]">
        <div className="absolute -top-40 left-[-10%] h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,#FFC0E4,transparent)]" />
      </div>
      <div className="relative z-10 min-h-screen w-full">
        <CopilotLayout />
      </div>
    </div>
  );
}

export default function BlossomAppShell() {
  return (
    <BlossomProvider>
      <AppContent />
    </BlossomProvider>
  );
}

