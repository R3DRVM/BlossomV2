/**
 * ExecutionModeSelector Component
 *
 * Multi-mode execution selector for the Blossom trading copilot.
 * Supports three execution modes:
 * - Direct: User signs each transaction manually
 * - Session: One-click execution with pre-approved session keys
 * - Confirm: Review plan before execution (default)
 *
 * Persists selection per wallet in localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { Zap, Shield, CheckCircle, ChevronDown, Info } from 'lucide-react';
import { useAccount } from 'wagmi';

export type ExecutionMode = 'direct' | 'session' | 'confirm';

interface ExecutionModeSelectorProps {
  onModeChange?: (mode: ExecutionMode) => void;
  className?: string;
  compact?: boolean;
}

// LocalStorage key generator
const getModeKey = (address: string) => `blossom_execution_mode_${address.toLowerCase()}`;

// Mode configurations
const MODES: Record<ExecutionMode, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  direct: {
    label: 'Direct Signing',
    shortLabel: 'Direct',
    description: 'Sign each transaction individually for full control',
    icon: Shield,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  session: {
    label: 'One-Click Session',
    shortLabel: 'One-Click',
    description: 'Pre-approve a session for instant execution',
    icon: Zap,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
  confirm: {
    label: 'Confirm Mode',
    shortLabel: 'Confirm',
    description: 'Review each plan before execution',
    icon: CheckCircle,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
};

export default function ExecutionModeSelector({
  onModeChange,
  className = '',
  compact = false,
}: ExecutionModeSelectorProps) {
  const { address, isConnected } = useAccount();
  const [mode, setMode] = useState<ExecutionMode>('confirm');
  const [isOpen, setIsOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  // Load saved mode on mount
  useEffect(() => {
    if (address) {
      const savedMode = localStorage.getItem(getModeKey(address));
      if (savedMode && (savedMode === 'direct' || savedMode === 'session' || savedMode === 'confirm')) {
        setMode(savedMode as ExecutionMode);
        onModeChange?.(savedMode as ExecutionMode);
      }
    }
  }, [address, onModeChange]);

  // Handle mode change
  const handleModeChange = useCallback((newMode: ExecutionMode) => {
    setMode(newMode);
    setIsOpen(false);

    if (address) {
      localStorage.setItem(getModeKey(address), newMode);
    }

    onModeChange?.(newMode);

    if (import.meta.env.DEV) {
      console.log('[ExecutionModeSelector] Mode changed to:', newMode);
    }
  }, [address, onModeChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-execution-mode-selector]')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  const currentMode = MODES[mode];
  const Icon = currentMode.icon;

  if (!isConnected) {
    return null;
  }

  // Compact mode: Just shows current mode as a pill
  if (compact) {
    return (
      <div className={`relative ${className}`} data-execution-mode-selector>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium
            ${currentMode.bgColor} ${currentMode.color} ${currentMode.borderColor} border
            hover:opacity-90 transition-opacity
          `}
        >
          <Icon className="w-3 h-3" />
          <span>{currentMode.shortLabel}</span>
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
            {(Object.keys(MODES) as ExecutionMode[]).map((modeKey) => {
              const modeConfig = MODES[modeKey];
              const ModeIcon = modeConfig.icon;
              const isSelected = mode === modeKey;

              return (
                <button
                  key={modeKey}
                  onClick={() => handleModeChange(modeKey)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 text-left text-xs
                    ${isSelected ? `${modeConfig.bgColor} ${modeConfig.color}` : 'text-slate-700 hover:bg-slate-50'}
                    transition-colors
                  `}
                >
                  <ModeIcon className="w-3.5 h-3.5" />
                  <div className="flex-1">
                    <div className="font-medium">{modeConfig.label}</div>
                    <div className="text-[10px] text-slate-500">{modeConfig.description}</div>
                  </div>
                  {isSelected && (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Full mode: Card with all options visible
  return (
    <div className={`${className}`} data-execution-mode-selector>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold tracking-[0.1em] text-slate-500 uppercase">
          Execution Mode
        </span>
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="relative"
        >
          <Info className="w-3 h-3 text-slate-400" />
          {showTooltip && (
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg shadow-lg z-50">
              Choose how transactions are signed. Session mode enables fastest execution.
            </div>
          )}
        </button>
      </div>

      <div className="flex gap-2">
        {(Object.keys(MODES) as ExecutionMode[]).map((modeKey) => {
          const modeConfig = MODES[modeKey];
          const ModeIcon = modeConfig.icon;
          const isSelected = mode === modeKey;

          return (
            <button
              key={modeKey}
              onClick={() => handleModeChange(modeKey)}
              className={`
                flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs
                transition-all duration-200
                ${isSelected
                  ? `${modeConfig.bgColor} ${modeConfig.borderColor} ${modeConfig.color} ring-2 ring-offset-1 ring-${modeConfig.color.replace('text-', '')}`
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }
              `}
            >
              <ModeIcon className={`w-4 h-4 ${isSelected ? modeConfig.color : 'text-slate-400'}`} />
              <span className="font-medium">{modeConfig.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Selected mode description */}
      <p className="mt-2 text-[10px] text-slate-500">
        {currentMode.description}
      </p>
    </div>
  );
}

// Export helper to get current mode for a wallet
export function getExecutionMode(address: string | undefined): ExecutionMode {
  if (!address) return 'confirm';
  const saved = localStorage.getItem(getModeKey(address));
  if (saved === 'direct' || saved === 'session' || saved === 'confirm') {
    return saved;
  }
  return 'confirm';
}
