/**
 * Blossom Logo Component
 * Renders cherry blossom logo with SVG fallback
 */

import blossomLogo from '../assets/blossom-logo.png';

type BlossomLogoProps = {
  className?: string;
  size?: number; // default 24
};

export function BlossomLogo({ className = '', size = 24 }: BlossomLogoProps) {
  const [imgError, setImgError] = React.useState(false);

  if (imgError) {
    // Fallback SVG if image fails to load
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: size, height: size }}
      >
        <circle cx="12" cy="12" r="3" fill="#FF6FB5" opacity="0.3" />
        <path
          d="M12 6C12 6 10 8 10 10C10 12 12 12 12 12C12 12 14 12 14 10C14 8 12 6 12 6Z"
          fill="#FF6FB5"
        />
        <path
          d="M18 10C18 10 16 10 15 11C14 12 15 13 16 12C17 11 18 10 18 10Z"
          fill="#FF6FB5"
        />
        <path
          d="M18 14C18 14 17 16 16 16C15 16 15 15 16 14C17 13 18 14 18 14Z"
          fill="#FF6FB5"
        />
        <path
          d="M12 18C12 18 12 16 10 16C8 16 8 17 9 17C10 17 12 18 12 18Z"
          fill="#FF6FB5"
        />
        <path
          d="M6 14C6 14 7 16 8 16C9 16 9 15 8 14C7 13 6 14 6 14Z"
          fill="#FF6FB5"
        />
        <path
          d="M6 10C6 10 7 10 8 11C9 12 8 13 7 12C6 11 6 10 6 10Z"
          fill="#FF6FB5"
        />
        <circle cx="12" cy="12" r="1.5" fill="#FF6FB5" />
      </svg>
    );
  }

  return (
    <img
      src={blossomLogo}
      alt="Blossom logo"
      className={`rounded-lg ${className}`}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}

