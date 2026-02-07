/**
 * Bundle agent for Vercel serverless deployment
 * Uses esbuild to create a single bundle with all dependencies
 *
 * IMPORTANT: This bundles dependencies for Vercel serverless functions
 * Only native modules are marked external
 */

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

console.log('🌸 Building Blossom Agent server bundle for Vercel...\n');

const startTime = Date.now();

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
