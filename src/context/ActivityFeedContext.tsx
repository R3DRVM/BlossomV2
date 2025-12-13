import { createContext, useContext, useState, ReactNode } from 'react';

export interface ActivityEvent {
  id: string;
  type: 'opened' | 'updated' | 'closed' | 'alert';
  positionId?: string;
  positionType?: 'perp' | 'event' | 'defi';
  message: string;
  timestamp: number;
  metadata?: {
    field?: string; // e.g., 'size', 'leverage', 'stake'
    oldValue?: string | number;
    newValue?: string | number;
  };
}

interface ActivityFeedContextType {
  events: ActivityEvent[];
  pushEvent: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  clear: () => void;
}

const ActivityFeedContext = createContext<ActivityFeedContextType | undefined>(undefined);

export function ActivityFeedProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const pushEvent = (eventData: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const event: ActivityEvent = {
      ...eventData,
      id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setEvents((prev) => [event, ...prev].slice(0, 10)); // Keep last 10 events
  };

  const clear = () => {
    setEvents([]);
  };

  return (
    <ActivityFeedContext.Provider value={{ events, pushEvent, clear }}>
      {children}
    </ActivityFeedContext.Provider>
  );
}

export function useActivityFeed() {
  const context = useContext(ActivityFeedContext);
  
  // Defensive fallback: return no-op implementation if provider is missing
  // This prevents hard crashes and allows graceful degradation
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('useActivityFeed called outside ActivityFeedProvider - using fallback (no events will be tracked)');
    }
    return {
      events: [],
      pushEvent: () => {},
      clear: () => {},
    };
  }
  
  return context;
}

