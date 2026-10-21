import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 47821);
const baseURL = `http://localhost:${PORT}`;

// The device presets carry a `defaultBrowserType` (webkit for the iPhone).
// We drive the system Chrome, so that key has to go.
const { defaultBrowserType: _pixelType, ...pixel5 } = devices['Pixel 5'];
const { defaultBrowserType: _iphoneType, ...iphone13 } = devices['iPhone 13'];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: Number(process.env.PW_WORKERS || 3),
  reporter: [['list']],

  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chrome',
    trace: 'retain-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'pixel5',
      use: { ...pixel5, channel: 'chrome' },
    },
    {
      name: 'iphone13',
      use: { ...iphone13, channel: 'chrome' },
    },
  ],

  webServer: {
    command: `node scripts/serve.js ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
