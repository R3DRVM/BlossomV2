import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning';

interface InlineToastProps {
  message: string;
  type?: ToastType;
  duration?: number; // milliseconds, 0 = persistent
  onDismiss?: () => void;
  className?: string;
}

export default function InlineToast({
  message,
  type = 'success',
  duration = 2000,
  onDismiss,
  className = '',
}: InlineToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0 && isVisible) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, isVisible, onDismiss]);

  if (!isVisible) return null;

  const iconMap = {
    success: <CheckCircle2 className="w-3.5 h-3.5" />,
    info: <Clock className="w-3.5 h-3.5" />,
    warning: <AlertCircle className="w-3.5 h-3.5" />,
  };

  const colorMap = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-full border ${colorMap[type]} ${className}`}
    >
      {iconMap[type]}
      <span>{message}</span>
    </div>
  );
}

