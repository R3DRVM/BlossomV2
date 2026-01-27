import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Blossom MVP acceptance tests
 */
export default defineConfig({
  testDir: './e2e',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter to use */
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL for API tests */
    baseURL: process.env.BACKEND_URL || 'http://localhost:3001',
    
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    
    /* Timeout for actions */
    actionTimeout: 30000,
  },

  /* Configure projects for API testing */
  projects: [
    {
      name: 'api-tests',
      testDir: './e2e',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Timeout for each test */
  timeout: 60000,

  /* Global timeout for the entire test run */
  globalTimeout: 300000,
});


