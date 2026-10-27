import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/production',
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 120000,
  outputDir: 'test-results/production',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/production' }],
    ['json', { outputFile: 'test-results/production/results.json' }],
    ['junit', { outputFile: 'test-results/production/junit.xml' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    browserName: 'chromium',
    channel: 'chromium',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 5175',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
  },
});
