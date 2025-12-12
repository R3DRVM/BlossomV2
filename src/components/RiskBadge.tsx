interface RiskBadgeProps {
  riskPercent?: number | null;
  className?: string;
}

export default function RiskBadge({ riskPercent, className = '' }: RiskBadgeProps) {
  // Render nothing if riskPercent is missing, NaN, or negative
  if (riskPercent == null || isNaN(riskPercent) || riskPercent < 0) {
    return null;
  }

  // Determine variant based on thresholds
  let variantClasses: string;
  let label: string;

  if (riskPercent <= 2) {
    variantClasses = 'bg-emerald-50 text-emerald-600';
    label = 'Low';
  } else if (riskPercent <= 5) {
    variantClasses = 'bg-amber-50 text-amber-600';
    label = 'Medium';
  } else {
    variantClasses = 'bg-rose-50 text-rose-600';
    label = 'High';
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${variantClasses} ${className}`.trim()}
    >
      {label} risk
    </span>
  );
}

