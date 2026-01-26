/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_USE_AGENT_BACKEND?: string;
  readonly VITE_AGENT_API_URL?: string;
  readonly VITE_AGENT_BASE_URL?: string;
  readonly VITE_SHOW_EXECUTION_METRICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

