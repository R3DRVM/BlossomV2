import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useBlossomContext } from '../context/BlossomContext';
import { useToast } from './toast/useToast';

// Helper to generate relative timestamp
function getRelativeTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function LeftSidebar() {
  const { resetSim, chatSessions, activeChatId, createNewChatSession, setActiveChat, deleteChatSession } = useBlossomContext();
  const { showToast } = useToast();
  const [isResetting, setIsResetting] = useState(false);
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);

  const handleNewChat = () => {
    const newId = createNewChatSession();
    setActiveChat(newId);
  };

  const handleResetSim = async () => {
    if (window.confirm('Reset SIM account to initial state?')) {
      setIsResetting(true);
      try {
        await resetSim();
        showToast({
          title: 'Simulation reset',
          description: 'Account, positions, and chats have been cleared.',
          variant: 'success',
        });
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
            {chatSessions.length === 0 ? (
              <div className="text-center py-6 px-3">
                <div className="text-xs font-medium text-slate-700 mb-1">No chats yet</div>
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Start by telling Blossom what you want to trade. For example: "Long ETH with 3% risk".
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Each chat keeps its own strategies and history, so you can experiment in separate threads.
                </div>
              </div>
            ) : (
              chatSessions.map((chat) => (
                <div
                  key={chat.id}
                  className={`relative flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                    activeChatId === chat.id
                      ? 'bg-pink-50 text-slate-900 font-medium'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <button
                    onClick={() => {
                      setActiveChat(chat.id);
                      setMenuOpenForId(null);
                    }}
                    className="flex-1 flex flex-col items-start text-left min-w-0"
                  >
                    <div className="font-medium text-slate-800 truncate w-full">{chat.title || 'New chat'}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{getRelativeTimestamp(chat.createdAt)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenForId((prev) => (prev === chat.id ? null : chat.id));
                    }}
                    className="ml-2 flex-shrink-0 rounded-full p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    aria-label="Chat actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  
                  {menuOpenForId === chat.id && (
                    <div className="absolute right-2 top-1/2 z-20 w-48 -translate-y-1/2 rounded-xl border border-slate-100 bg-white shadow-lg px-3 py-2">
                      <div className="text-[11px] font-medium text-slate-800">
                        Delete this chat?
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        This will remove its messages from the history.
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-full px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-100 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenForId(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-full bg-pink-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-pink-600 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChatSession(chat.id);
                            setMenuOpenForId(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

