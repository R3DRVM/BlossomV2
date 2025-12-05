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
    <div className="h-screen flex flex-col bg-gray-100">
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

