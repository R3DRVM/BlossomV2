import { useState, useEffect } from 'react';
import { BlossomProvider, useBlossomContext } from './context/BlossomContext';
import { ActivityFeedProvider } from './context/ActivityFeedContext';
import Header from './components/Header';
import TabNav from './components/TabNav';
import AccountSummaryStrip from './components/AccountSummaryStrip';
import { SimBanner } from './components/SimBanner';
import CopilotLayout from './components/CopilotLayout';
import RiskCenter from './components/RiskCenter';
import PortfolioView from './components/PortfolioView';
import CommandBar from './components/CommandBar';

function AppContent() {
  const { activeTab, setActiveTab } = useBlossomContext();
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);

  // Listen for Cmd/Ctrl+K to open command bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandBarOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);


  const handleInsertChatPrompt = (text: string) => {
    // Dispatch event that Chat component listens to (matches StrategyDrawer format)
    window.dispatchEvent(
      new CustomEvent('insertChatPrompt', {
        detail: { prompt: text },
      })
    );
  };

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

      {/* Command Bar */}
      <CommandBar
        isOpen={isCommandBarOpen}
        onClose={() => setIsCommandBarOpen(false)}
        onNavigate={(tab) => setActiveTab(tab)}
        onInsertChatPrompt={handleInsertChatPrompt}
      />
    </div>
  );
}

function App() {
  return (
    <BlossomProvider>
      <ActivityFeedProvider>
        <AppContent />
      </ActivityFeedProvider>
    </BlossomProvider>
  );
}

export default App;

