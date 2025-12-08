import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';

interface ChatHistoryItem {
  id: string;
  title: string;
  timestamp: string;
}

export default function LeftSidebar() {
  const { resetSim } = useBlossomContext();
  const [isResetting, setIsResetting] = useState(false);
  
  // Mock chat history - in a real app, this would come from context/state
  const [chatHistory] = useState<ChatHistoryItem[]>([
    { id: '1', title: 'ETH Long Strategy', timestamp: '2h ago' },
    { id: '2', title: 'DeFi Yield Planning', timestamp: '1d ago' },
    { id: '3', title: 'Risk Assessment', timestamp: '2d ago' },
    { id: '4', title: 'Portfolio Review', timestamp: '3d ago' },
    { id: '5', title: 'BTC Hedging Plan', timestamp: '5d ago' },
  ]);
  const [activeChatId] = useState<string>('1'); // Current chat session

  const handleNewChat = () => {
    // TODO: In a real implementation, this would create a new chat session
    // and reset the Chat component's message state
    console.log('New chat clicked - TODO: implement chat reset');
  };

  const handleResetSim = async () => {
    if (window.confirm('Reset SIM account to initial state?')) {
      setIsResetting(true);
      try {
        await resetSim();
      } catch (error: any) {
        alert(`Failed to reset: ${error.message}`);
      } finally {
        setIsResetting(false);
      }
    }
  };

  return (
    <div className="w-64 h-full bg-slate-50/80 border-r border-slate-100 flex flex-col min-h-0 overflow-hidden">
      {/* User Profile Card */}
      <div className="px-4 pt-4 flex-shrink-0">
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blossom-pink/10 flex items-center justify-center flex-shrink-0">
              <span className="text-blossom-pink font-semibold text-sm">U</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">User</div>
              <div className="text-[11px] text-slate-500 truncate">user@gmail.com</div>
            </div>
          </div>
          {/* Reset SIM Button */}
          <button
            onClick={handleResetSim}
            disabled={isResetting}
            className="w-full rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? 'Resetting...' : 'Reset SIM'}
          </button>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-4 pt-3 flex-shrink-0">
        <button
          onClick={handleNewChat}
          className="w-full rounded-2xl bg-white border border-slate-100 shadow-sm px-4 py-3 text-xs font-semibold text-slate-800 hover:bg-pink-50/70 hover:border-pink-200 transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-lg">+</span>
          <span>New chat</span>
        </button>
      </div>

      {/* Chat History */}
      <div className="px-4 pt-3 pb-4 flex-1 min-h-0">
        <div className="h-full rounded-2xl border border-slate-100 bg-white shadow-sm p-3 flex flex-col">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase mb-2">
            CHAT HISTORY
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {chatHistory.map((chat) => (
              <button
                key={chat.id}
                onClick={() => {
                  // TODO: In a real implementation, this would load the chat
                  console.log('Load chat:', chat.id);
                }}
                className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-colors ${
                  activeChatId === chat.id
                    ? 'bg-pink-50 text-slate-900 font-medium'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="font-medium text-slate-800 truncate">{chat.title}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{chat.timestamp}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

