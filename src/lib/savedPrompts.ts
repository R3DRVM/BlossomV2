const STORAGE_KEY = 'blossom.savedPrompts';

export interface SavedPrompt {
  id: string;
  text: string;
  createdAt: number;
}

export function getSavedPrompts(): SavedPrompt[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function savePrompt(text: string): SavedPrompt {
  const prompts = getSavedPrompts();
  const newPrompt: SavedPrompt = {
    id: `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text,
    createdAt: Date.now(),
  };
  prompts.push(newPrompt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  return newPrompt;
}

export function deletePrompt(id: string): void {
  const prompts = getSavedPrompts();
  const filtered = prompts.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function isPromptSaved(text: string): boolean {
  const prompts = getSavedPrompts();
  return prompts.some(p => p.text.toLowerCase().trim() === text.toLowerCase().trim());
}



