/**
 * Bundle agent for Vercel serverless deployment
 * Uses esbuild to create a single bundle with all dependencies
 *
 * IMPORTANT: This bundles dependencies for Vercel serverless functions
 * Only native modules are marked external
 */

import * as esbuild from 'esbuild';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgerPath = resolve(__dirname, 'agent/dist/execution-ledger');

console.log('🌸 Building Blossom Agent server bundle for Vercel...\n');
console.log(`   Working dir: ${__dirname}`);
console.log(`   Ledger path: ${ledgerPath}`);

const startTime = Date.now();

// Plugin to resolve relative imports - handles all execution-ledger paths
const resolvePlugin = {
  name: 'resolve-agent-paths',
  setup(build) {
    // Handle all relative .js imports by resolving from the importer's directory
    build.onResolve({ filter: /^\.\/.*\.js$/ }, args => {
      const dir = dirname(args.importer);
      const resolved = resolve(dir, args.path);
      if (existsSync(resolved)) {
        return { path: resolved };
      }
      return null;
    });

    // Handle imports like '../../execution-ledger/db-pg-client'
    build.onResolve({ filter: /execution-ledger\/[^/]+$/ }, args => {
      const moduleName = basename(args.path);
      const resolved = join(ledgerPath, moduleName + '.js');
      if (existsSync(resolved)) {
        return { path: resolved };
      }
      return null;
    });
  }
};

try {
  const result = await esbuild.build({
    entryPoints: ['agent/dist/src/server/http.js'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: 'agent/dist/server-bundle.js',
    sourcemap: true,
    // Only exclude native modules that can't be bundled
    external: [
      'better-sqlite3',
      'pg-native',
    ],
    // Polyfill require() for CommonJS dependencies in ESM context
    banner: {
      js: "import{createRequire}from'module';const require=createRequire(import.meta.url);"
    },
    logLevel: 'info',
    metafile: true,
    plugins: [resolvePlugin],
  });

  // Log bundle stats
  const bundleSize = readFileSync('agent/dist/server-bundle.js').length;
  const bundleSizeMB = (bundleSize / 1024 / 1024).toFixed(2);

  console.log(`\n✅ Agent server bundled successfully!`);
  console.log(`   Size: ${bundleSizeMB} MB`);
  console.log(`   Output: agent/dist/server-bundle.js`);
  console.log(`   Time: ${Date.now() - startTime}ms\n`);

  // Warn if bundle is too large for Vercel (50MB limit)
  if (bundleSize > 50 * 1024 * 1024) {
    console.warn('⚠️  Warning: Bundle exceeds Vercel 50MB limit!\n');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
