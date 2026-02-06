import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Get build SHA from Vercel env or git
function getBuildSha(): string {
  // Vercel provides git commit SHA in production builds
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  // Fallback to git for local builds
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return sha;
  } catch {
    return 'dev';
  }
}

// Get branch from Vercel env or git
function getBuildBranch(): string {
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    return process.env.VERCEL_GIT_COMMIT_REF;
  }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return branch;
  } catch {
    return 'unknown';
  }
}

// Get build environment
function getBuildEnv(): string {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV; // 'production', 'preview', or 'development'
  }
  return process.env.NODE_ENV || 'development';
}

const BUILD_SHA = getBuildSha();
const BUILD_BRANCH = getBuildBranch();
const BUILD_ENV = getBuildEnv();
const BUILD_TIME = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Ensure Buffer is available for Solana wallet adapters
  define: {
    'process.env': {},
    global: 'globalThis',
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
    __BUILD_ENV__: JSON.stringify(BUILD_ENV),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  // Stabilize pre-bundle to avoid 504 Outdated Optimize Dep / blank screen.
  // If it still happens: rm -rf node_modules/.vite .vite && npm run dev -- --force
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'buffer'],
    exclude: [],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  server: {
    host: '0.0.0.0', // Bind to all interfaces (ensures 127.0.0.1 works)
    port: 5173,
    strictPort: true, // Fail if port is already in use
  },
})

