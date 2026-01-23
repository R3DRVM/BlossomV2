/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_AGENT_BACKEND?: string;
  readonly VITE_AGENT_API_URL?: string;
  readonly VITE_AGENT_BASE_URL?: string;
  readonly VITE_SHOW_EXECUTION_METRICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

