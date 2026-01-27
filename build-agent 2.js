/**
 * Bundle agent for Vercel serverless deployment
 * Uses esbuild to create a single bundle with all dependencies
 */

import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['agent/src/server/http.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'agent/dist/server-bundle.js',
  packages: 'external', // Mark all node_modules as external
  sourcemap: true,
  minify: false,
});

console.log('✅ Agent server bundled to agent/dist/server-bundle.js');
