/**
 * Button Component
 * Simple button matching SuddenGreenCad style
 */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline';
  className?: string;
  children: React.ReactNode;
}

export function Button({ variant = 'default', className = '', children, ...props }: ButtonProps) {
  const baseClasses = 'inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium transition-all';
  const variantClasses = {
    default: 'bg-[#F25AA2] hover:bg-[#F25AA2]/90 text-white shadow-lg',
    outline: 'border border-[#E5E5E5] hover:bg-[#FAFAFA] text-[#111111] bg-white/50',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

