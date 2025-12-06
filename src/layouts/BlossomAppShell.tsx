import { BlossomProvider, useBlossomContext } from '../context/BlossomContext';
import Header from '../components/Header';
import TabNav from '../components/TabNav';
import AccountSummaryStrip from '../components/AccountSummaryStrip';
import { SimBanner } from '../components/SimBanner';
import CopilotLayout from '../components/CopilotLayout';
import RiskCenter from '../components/RiskCenter';
import PortfolioView from '../components/PortfolioView';

function AppContent() {
  const { activeTab } = useBlossomContext();

  return (
    <div className="min-h-screen bg-blossom-surface relative overflow-hidden">
      {/* Stable subtle blossom bloom gradient - does not change on tab switch */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.16]">
        <div className="absolute -top-40 left-[-10%] h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,#FFC0E4,transparent)]" />
      </div>
      <div className="relative z-10 flex flex-col h-screen">
        <Header />
        <SimBanner />
        <TabNav />
        <AccountSummaryStrip />
        <main className="flex-1 overflow-hidden">
        <div className={`h-full transition-opacity duration-150 ease-out ${activeTab === 'copilot' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'copilot' && <CopilotLayout />}
        </div>
        <div className={`h-full transition-opacity duration-150 ease-out ${activeTab === 'risk' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'risk' && <RiskCenter />}
        </div>
        <div className={`h-full transition-opacity duration-150 ease-out ${activeTab === 'portfolio' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'portfolio' && <PortfolioView />}
        </div>
      </main>
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

