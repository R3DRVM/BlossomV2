import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface PendingPlan {
  id: string;
  type: 'perp' | 'event' | 'defi';
  timestamp: number;
}

interface ExecutionContextType {
  pendingPlans: PendingPlan[];
  addPendingPlan: (id: string, type: 'perp' | 'event' | 'defi') => void;
  removePendingPlan: (id: string) => void;
  clearPendingPlans: () => void;
  lastAction: string | null;
  setLastAction: (action: string | null) => void;
}

const ExecutionContext = createContext<ExecutionContextType | undefined>(undefined);

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const addPendingPlan = useCallback((id: string, type: 'perp' | 'event' | 'defi') => {
    setPendingPlans(prev => {
      // Avoid duplicates
      if (prev.some(p => p.id === id)) return prev;
      return [...prev, { id, type, timestamp: Date.now() }];
    });
  }, []);

  const removePendingPlan = useCallback((id: string) => {
    setPendingPlans(prev => prev.filter(p => p.id !== id));
  }, []);

  const clearPendingPlans = useCallback(() => {
    setPendingPlans([]);
  }, []);

  return (
    <ExecutionContext.Provider
      value={{
        pendingPlans,
        addPendingPlan,
        removePendingPlan,
        clearPendingPlans,
        lastAction,
        setLastAction,
      }}
    >
      {children}
    </ExecutionContext.Provider>
  );
}

export function useExecution() {
  const context = useContext(ExecutionContext);
  if (!context) {
    return {
      pendingPlans: [],
      addPendingPlan: () => {},
      removePendingPlan: () => {},
      clearPendingPlans: () => {},
      lastAction: null,
      setLastAction: () => {},
    };
  }
  return context;
}

