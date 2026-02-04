import { useState, useEffect } from 'react';
import { MoreHorizontal, Pencil, Check, X, Wallet } from 'lucide-react';
import { useBlossomContext } from '../context/BlossomContext';
import { useToast } from './toast/useToast';
import { useAccount } from 'wagmi';
import { isSessionEnabled, isManualSigningEnabled } from './SessionEnforcementModal';
import OneClickExecution from './OneClickExecution';

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

// localStorage keys for profile
const DISPLAY_NAME_KEY = 'blossom_profile_display_name';
const PROFILE_EMAIL_KEY = 'blossom_profile_email';

export default function LeftSidebar() {
  const { chatSessions, activeChatId, createNewChatSession, setActiveChat, deleteChatSession } = useBlossomContext();
  const { showToast } = useToast();
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);

  // Profile state
  const { address, isConnected } = useAccount();
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(DISPLAY_NAME_KEY) || '';
    }
    return '';
  });
  const [profileEmail, setProfileEmail] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(PROFILE_EMAIL_KEY) || '';
    }
    return '';
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [tempName, setTempName] = useState(displayName);
  const [tempEmail, setTempEmail] = useState(profileEmail);

  // Get signing mode
  const signingMode = address
    ? isSessionEnabled(address)
      ? 'Session Enabled'
      : isManualSigningEnabled(address)
        ? 'Manual Signing'
        : 'Not Set'
    : 'Not Connected';

  const handleNewChat = () => {
    const newId = createNewChatSession();
    setActiveChat(newId);
  };

  const handleSaveName = () => {
    localStorage.setItem(DISPLAY_NAME_KEY, tempName);
    setDisplayName(tempName);
    setIsEditingName(false);
    showToast({ title: 'Profile updated', description: 'Display name saved.', variant: 'success' });
  };

  const handleSaveEmail = () => {
    localStorage.setItem(PROFILE_EMAIL_KEY, tempEmail);
    setProfileEmail(tempEmail);
    setIsEditingEmail(false);
    showToast({ title: 'Profile updated', description: 'Email saved.', variant: 'success' });
  };

  const handleCancelName = () => {
    setTempName(displayName);
    setIsEditingName(false);
  };

  const handleCancelEmail = () => {
    setTempEmail(profileEmail);
    setIsEditingEmail(false);
  };

  // Format wallet address for display
  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="w-64 h-full bg-slate-50/80 border-r border-slate-100 flex flex-col min-h-0 overflow-hidden">
      {/* User Profile Card */}
      <div className="px-4 pt-4 flex-shrink-0">
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-3 space-y-3">
          {/* Display Name */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Display Name</div>
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder="Enter name"
                  className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-pink-300"
                  autoFocus
                />
                <button onClick={handleSaveName} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={handleCancelName} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-900">{displayName || 'Not set'}</span>
                <button onClick={() => { setTempName(displayName); setIsEditingName(true); }} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Connected Wallet */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Wallet</div>
            <div className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs font-mono text-slate-700">
                {isConnected && address ? formatAddress(address) : 'Not connected'}
              </span>
            </div>
          </div>

          {/* Signing Mode */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Signing Mode</div>
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
              signingMode === 'Session Enabled' ? 'bg-emerald-100 text-emerald-700' :
              signingMode === 'Manual Signing' ? 'bg-amber-100 text-amber-700' :
              'bg-slate-100 text-slate-600'
            }`}>
              {signingMode}
            </div>
            {isConnected && address && (
              <div className="pt-1">
                <OneClickExecution userAddress={address} />
              </div>
            )}
          </div>

          {/* Email (optional) */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Email (optional)</div>
            {isEditingEmail ? (
              <div className="flex items-center gap-1">
                <input
                  type="email"
                  value={tempEmail}
                  onChange={(e) => setTempEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-pink-300"
                  autoFocus
                />
                <button onClick={handleSaveEmail} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={handleCancelEmail} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-700">{profileEmail || 'Not set'}</span>
                <button onClick={() => { setTempEmail(profileEmail); setIsEditingEmail(true); }} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
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
