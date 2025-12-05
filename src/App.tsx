import { BlossomProvider, useBlossomContext } from './context/BlossomContext';
import Header from './components/Header';
import TabNav from './components/TabNav';
import AccountSummaryStrip from './components/AccountSummaryStrip';
import { SimBanner } from './components/SimBanner';
import CopilotLayout from './components/CopilotLayout';
import RiskCenter from './components/RiskCenter';
import PortfolioView from './components/PortfolioView';

function AppContent() {
  const { activeTab } = useBlossomContext();

  return (
    <div className="min-h-screen bg-blossom-surface relative">
      {/* Subtle blossom bloom gradient - positioned behind chat area */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(244,114,182,0.18),transparent_55%)]" />
      <div className="relative z-10 flex flex-col h-screen">
        <Header />
        <SimBanner />
        <TabNav />
        <AccountSummaryStrip />
        <main className="flex-1 overflow-hidden">
        <div className={`h-full transition-opacity duration-200 ${activeTab === 'copilot' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'copilot' && <CopilotLayout />}
        </div>
        <div className={`h-full transition-opacity duration-200 ${activeTab === 'risk' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'risk' && <RiskCenter />}
        </div>
        <div className={`h-full transition-opacity duration-200 ${activeTab === 'portfolio' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
          {activeTab === 'portfolio' && <PortfolioView />}
        </div>
      </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BlossomProvider>
      <AppContent />
    </BlossomProvider>
  );
}

export default App;

