import { defineConfig } from '@playwright/test';
// Two fresh loopback listeners with injected SYNTHETIC data; never reuse an app.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: '.private/e2e-results',
  reporter: [
    ['list'],
    ['json', { outputFile: '.private/evidence/e2e-results.json' }],
    ['html', { outputFolder: '.private/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4181', browserName: 'chromium', channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
