import { defineConfig, devices } from '@playwright/test';

// Playwright's bundled Chromium doesn't run on Windows ARM64, so local runs drive the installed Edge.
// CI runs on Linux x64 and uses the bundled Chromium.
const edge = process.env.CI ? {} : { channel: 'msedge' as const };
const desktop = { width: 1440, height: 900 };
const desktopSpecs = /(round|shots|selftest|blur)\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop-edge', testMatch: desktopSpecs, use: { ...devices['Desktop Chrome'], ...edge, viewport: desktop } },
    { name: 'desktop-webkit', testMatch: desktopSpecs, use: { ...devices['Desktop Safari'], viewport: desktop } },
    { name: 'iphone', testMatch: /phone\.spec\.ts/, use: { ...devices['iPhone 13'] } },
    { name: 'pixel', testMatch: /phone\.spec\.ts/, use: { ...devices['Pixel 7'], ...edge } },
    { name: 'parity', testMatch: /parity\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...edge } },
  ],
});
