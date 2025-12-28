import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Coachmark {
  id: string;
  targetSelector: string;
  fallbackSelector?: string;
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  waitForTarget?: boolean;
  waitTimeoutMs?: number;
}

const EVENT_COACHMARKS: Coachmark[] = [
  {
    id: 'event-tab',
    targetSelector: '[data-coachmark="event-tab"]',
    title: 'Event Markets',
    description: 'Switch between on-chain perps and prediction markets',
    position: 'bottom',
  },
  {
    id: 'event-explore-top-markets',
    targetSelector: '[data-coachmark="event-explore-top-markets"]',
    fallbackSelector: '[data-coachmark="quick-actions"]',
    title: 'Explore Markets',
    description: 'Browse high-volume markets and place positions',
    position: 'top',
  },
  {
    id: 'event-draft-card',
    targetSelector: '[data-coachmark="event-draft-card"]',
    title: 'Review Your Position',
    description: 'Blossom sizes risk, shows payout, and enforces limits before execution.',
    position: 'top',
    waitForTarget: true,
    waitTimeoutMs: 10000,
  },
];

interface EventMarketsCoachmarksProps {
  onComplete: () => void;
}

export default function EventMarketsCoachmarks({ onComplete }: EventMarketsCoachmarksProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [coachmarkPosition, setCoachmarkPosition] = useState<{ top: number; left: number } | null>(null);
  const [isWaitingForTarget, setIsWaitingForTarget] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const originalStylesRef = useRef<{ zIndex: string; position: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Clamp position to viewport bounds
  const clampPosition = (top: number, left: number, coachmarkWidth: number = 240, coachmarkHeight: number = 200): { top: number; left: number } => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 12;

    // Clamp left
    if (left < padding) {
      left = padding;
    } else if (left + coachmarkWidth > viewportWidth - padding) {
      left = viewportWidth - coachmarkWidth - padding;
    }

    // Clamp top
    if (top < padding) {
      top = padding;
    } else if (top + coachmarkHeight > viewportHeight - padding) {
      top = viewportHeight - coachmarkHeight - padding;
    }

    return { top, left };
  };

  // Calculate and update coachmark position
  const updatePosition = () => {
    if (!targetRef.current) return;

    const coachmark = EVENT_COACHMARKS[currentStep];
    const rect = targetRef.current.getBoundingClientRect();
    const coachmarkHeight = 200;
    const coachmarkWidth = 240;
    const spacing = 12;
    
    let top = 0;
    let left = 0;
    
    switch (coachmark.position) {
      case 'bottom':
        top = rect.bottom + spacing;
        left = rect.left + rect.width / 2;
        break;
      case 'top':
        // Position above target with spacing, but ensure it fits
        top = rect.top - coachmarkHeight - spacing;
        left = rect.left + rect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - coachmarkWidth - spacing;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + spacing;
        break;
    }

    const clamped = clampPosition(top, left, coachmarkWidth, coachmarkHeight);
    setCoachmarkPosition(clamped);
  };

  // Throttled position update using requestAnimationFrame
  const schedulePositionUpdate = () => {
    if (rafIdRef.current !== null) {
      return; // Already scheduled
    }
    rafIdRef.current = requestAnimationFrame(() => {
      updatePosition();
      rafIdRef.current = null;
    });
  };

  useEffect(() => {
    if (currentStep >= EVENT_COACHMARKS.length) {
      onComplete();
      return;
    }

    const coachmark = EVENT_COACHMARKS[currentStep];
    let timeoutId: ReturnType<typeof setTimeout>;
    let waitIntervalId: ReturnType<typeof setInterval> | null = null;
    let waitStartTime = Date.now();
    
    const findAndPositionTarget = (selector: string): HTMLElement | null => {
      return document.querySelector(selector) as HTMLElement;
    };

    const setupTarget = (target: HTMLElement) => {
      // Store original styles before modifying
      if (!originalStylesRef.current) {
        originalStylesRef.current = {
          zIndex: target.style.zIndex || '',
          position: target.style.position || '',
        };
      }

      targetRef.current = target;
      
      // Apply highlight styles
      target.style.zIndex = '1000';
      target.style.position = 'relative';
      
      // Calculate and set initial position
      updatePosition();
      setIsWaitingForTarget(false);
    };

    const tryFindTarget = () => {
      // Try primary target first
      let target = findAndPositionTarget(coachmark.targetSelector);
      
      // If not found and fallback exists, try fallback
      if (!target && coachmark.fallbackSelector) {
        target = findAndPositionTarget(coachmark.fallbackSelector);
      }
      
      if (target) {
        if (waitIntervalId) {
          clearInterval(waitIntervalId);
        }
        setupTarget(target);
        return true;
      }
      
      return false;
    };
    
    // Initial delay to ensure DOM is ready
    timeoutId = setTimeout(() => {
      if (tryFindTarget()) {
        return; // Target found, done
      }

      // If target not found and we should wait for it
      if (coachmark.waitForTarget && coachmark.waitTimeoutMs) {
        setIsWaitingForTarget(true);
        waitStartTime = Date.now();
        waitIntervalId = setInterval(() => {
          if (tryFindTarget()) {
            return; // Target found
          }
          
          // Timeout reached, end gracefully
          if (Date.now() - waitStartTime >= coachmark.waitTimeoutMs!) {
            if (waitIntervalId) {
              clearInterval(waitIntervalId);
            }
            setIsWaitingForTarget(false);
            onComplete();
          }
        }, 200); // Check every 200ms
      } else {
        // No wait requested, skip immediately
        setCurrentStep(prev => prev + 1);
      }
    }, 100);

    // Handle window resize and scroll
    const handleResize = () => {
      schedulePositionUpdate();
    };

    const handleScroll = () => {
      schedulePositionUpdate();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true); // Use capture phase to catch all scrolls

    return () => {
      clearTimeout(timeoutId);
      if (waitIntervalId) {
        clearInterval(waitIntervalId);
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      
      // Restore original styles (don't blank them)
      if (targetRef.current && originalStylesRef.current) {
        targetRef.current.style.zIndex = originalStylesRef.current.zIndex;
        targetRef.current.style.position = originalStylesRef.current.position;
        originalStylesRef.current = null;
      }
      targetRef.current = null;
    };
  }, [currentStep, onComplete]);

  const handleNext = () => {
    setCurrentStep(prev => prev + 1);
  };

  const handleSkip = () => {
    onComplete();
  };

  if (currentStep >= EVENT_COACHMARKS.length) {
    return null;
  }

  const coachmark = EVENT_COACHMARKS[currentStep];

  // Show coachmark even if waiting for target (with waiting message)
  if (!coachmarkPosition && !isWaitingForTarget) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999]"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Backdrop - no click handler, doesn't advance steps */}
      <div className="absolute inset-0 bg-black/40" />
      
      {/* Coachmark */}
      {(coachmarkPosition || isWaitingForTarget) && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 p-4 max-w-[240px] pointer-events-auto z-[10000]"
          style={{
            top: coachmarkPosition ? `${coachmarkPosition.top}px` : '50%',
            left: coachmarkPosition ? `${coachmarkPosition.left}px` : '50%',
            transform: coachmarkPosition 
              ? (coachmark.position === 'left' || coachmark.position === 'right' 
                  ? 'translateY(-50%)' 
                  : 'translateX(-50%)')
              : 'translate(-50%, -50%)',
          }}
        >
        <div className="flex items-start justify-between mb-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-900 mb-1">{coachmark.title}</h4>
            {isWaitingForTarget ? (
              <p className="text-[10px] text-slate-600">Create an event draft to continue</p>
            ) : (
              <p className="text-[10px] text-slate-600">{coachmark.description}</p>
            )}
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
            {currentStep + 1} of {EVENT_COACHMARKS.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkip}
              className="px-2 py-1 text-[10px] font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Skip
            </button>
            {!isWaitingForTarget && (
              <button
                onClick={handleNext}
                className="px-2 py-1 text-[10px] font-medium bg-pink-500 text-white rounded hover:bg-pink-600 transition-colors"
              >
                {currentStep === EVENT_COACHMARKS.length - 1 ? 'Got it' : 'Next'}
              </button>
            )}
          </div>
        </div>
        <label className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
          <input
            type="checkbox"
            onChange={(e) => {
              if (e.target.checked) {
                localStorage.setItem('blossom.onboardingSeen.event', 'true');
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
