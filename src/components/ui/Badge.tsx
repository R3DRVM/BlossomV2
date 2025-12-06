/**
 * Badge Component
 * Simple badge matching SuddenGreenCad style
 */

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outline';
  children: React.ReactNode;
}

export function Badge({ variant = 'outline', className = '', children, ...props }: BadgeProps) {
  const baseClasses = 'inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm shadow-sm';
  const variantClasses = {
    default: 'bg-[#F25AA2] text-white',
    outline: 'border border-[#F25AA2]/30 text-[#F25AA2] bg-white/80',
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

