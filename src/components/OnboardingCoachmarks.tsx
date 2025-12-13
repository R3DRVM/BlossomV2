import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Coachmark {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const COACHMARKS: Coachmark[] = [
  {
    id: 'execution-mode',
    targetSelector: '[data-coachmark="execution-mode"]',
    title: 'Execution Mode',
    description: 'Choose how plans execute: Auto (immediate), Confirm (requires approval), or Manual (copy plan)',
    position: 'bottom',
  },
  {
    id: 'quick-actions',
    targetSelector: '[data-coachmark="quick-actions"]',
    title: 'Quick Actions',
    description: 'Start with suggested prompts or save your own favorites',
    position: 'top',
  },
  {
    id: 'positions-editor',
    targetSelector: '[data-coachmark="positions-editor"]',
    title: 'Positions Editor',
    description: 'Edit size, leverage, TP/SL without leaving chat',
    position: 'left',
  },
];

interface OnboardingCoachmarksProps {
  onComplete: () => void;
}

export default function OnboardingCoachmarks({ onComplete }: OnboardingCoachmarksProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [coachmarkPosition, setCoachmarkPosition] = useState<{ top: number; left: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (currentStep >= COACHMARKS.length) {
      onComplete();
      return;
    }

    const coachmark = COACHMARKS[currentStep];
    
    // Small delay to ensure DOM is ready
    const timeout = setTimeout(() => {
      const target = document.querySelector(coachmark.targetSelector) as HTMLElement;
      
      if (!target) {
        // Target not found, skip to next
        setCurrentStep(prev => prev + 1);
        return;
      }

      targetRef.current = target;
      
      // Calculate position relative to viewport
      const rect = target.getBoundingClientRect();
      
      let top = 0;
      let left = 0;
      
      switch (coachmark.position) {
        case 'bottom':
          top = rect.bottom + 12;
          left = rect.left + rect.width / 2;
          break;
        case 'top':
          top = rect.top - 120;
          left = rect.left + rect.width / 2;
          break;
        case 'left':
          top = rect.top + rect.height / 2;
          left = rect.left - 240;
          break;
        case 'right':
          top = rect.top + rect.height / 2;
          left = rect.right + 12;
          break;
      }
      
      setCoachmarkPosition({ top, left });
      
      // Highlight target
      target.style.zIndex = '1000';
      target.style.position = 'relative';
    }, 100);
    
    return () => {
      clearTimeout(timeout);
      if (targetRef.current) {
        targetRef.current.style.zIndex = '';
        targetRef.current.style.position = '';
      }
    };
  }, [currentStep, onComplete]);

  const handleNext = () => {
    setCurrentStep(prev => prev + 1);
  };

  const handleSkip = () => {
    onComplete();
  };

  if (currentStep >= COACHMARKS.length || !coachmarkPosition) {
    return null;
  }

  const coachmark = COACHMARKS[currentStep];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] pointer-events-none"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleNext} />
      
      {/* Coachmark */}
      {coachmarkPosition && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 p-4 max-w-[240px] pointer-events-auto z-[10000]"
          style={{
            top: `${coachmarkPosition.top}px`,
            left: `${coachmarkPosition.left}px`,
            transform: coachmark.position === 'left' || coachmark.position === 'right' 
              ? 'translateY(-50%)' 
              : 'translateX(-50%)',
          }}
        >
        <div className="flex items-start justify-between mb-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-900 mb-1">{coachmark.title}</h4>
            <p className="text-[10px] text-slate-600">{coachmark.description}</p>
          </div>
          <button
            onClick={handleSkip}
            className="text-slate-400 hover:text-slate-600 transition-colors ml-2 flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
          <div className="text-[9px] text-slate-500">
            {currentStep + 1} of {COACHMARKS.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkip}
              className="px-2 py-1 text-[10px] font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-2 py-1 text-[10px] font-medium bg-pink-500 text-white rounded hover:bg-pink-600 transition-colors"
            >
              {currentStep === COACHMARKS.length - 1 ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
          <input
            type="checkbox"
            onChange={(e) => {
              if (e.target.checked) {
                localStorage.setItem('blossom.onboardingSeen', 'true');
              }
            }}
            className="w-3 h-3 rounded border-slate-300 text-pink-500 focus:ring-pink-500"
          />
          <span className="text-[9px] text-slate-500">Don't show again</span>
        </label>
        </div>
      )}
    </div>
  );
}

