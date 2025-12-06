/**
 * Card Component
 * Simple card matching SuddenGreenCad style
 */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-[#E5E5E5] bg-white/60 backdrop-blur-md p-6 shadow-lg ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

