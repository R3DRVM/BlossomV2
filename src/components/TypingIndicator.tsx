import { BlossomLogo } from './BlossomLogo';

export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="animate-spin">
        <BlossomLogo size={20} />
      </div>
      <span className="text-sm text-gray-500">Blossom is thinking...</span>
    </div>
  );
}

