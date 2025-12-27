import React from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  rightActions?: React.ReactNode;
  className?: string;
}

export default function SectionHeader({ title, subtitle, rightActions, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex items-start justify-between mb-4 ${className}`}>
      <div className="flex-1">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && (
          <span className="text-xs text-gray-500 mt-0.5 block">{subtitle}</span>
        )}
      </div>
      {rightActions && (
        <div className="flex items-center gap-2 ml-4">
          {rightActions}
        </div>
      )}
    </div>
  );
}



