/**
 * Vercel Serverless API Entrypoint
 * Wraps the Express app from agent/src/server/http.ts
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Import the Express app (exported from http.ts)
let app: any = null;
let appInitialized = false;

async function getApp() {
  if (!app) {
    // Set Vercel environment flag before importing
    process.env.VERCEL = '1';
    
    const httpModule = await import('../agent/src/server/http.js');
    app = httpModule.app;
    appInitialized = true;
  }
  return app;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const expressApp = await getApp();
    
    // Express app is a function that takes (req, res, next)
    // Vercel's req/res are compatible with Express
    return expressApp(req, res);
  } catch (error: any) {
    console.error('[Serverless] Handler error:', error.message);
    console.error('[Serverless] Full error:', error);
    console.error('[Serverless] Stack:', error.stack);
    res.status(500).json({
      ok: false,
      error: {
        message: 'Internal server error',
        code: 'SERVERLESS_HANDLER_ERROR',
        details: error.message
      }
    });
  }
}
