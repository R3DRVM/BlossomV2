/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_AGENT_BACKEND?: string;
  readonly VITE_AGENT_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

