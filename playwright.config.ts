import { defineConfig, devices } from '@playwright/test';

// Playwright's bundled Chromium doesn't run on Windows ARM64, so local runs drive the installed Edge.
// CI runs on Linux x64 and uses the bundled Chromium.
const edge = process.env.CI ? {} : { channel: 'msedge' as const };
const desktop = { width: 1440, height: 900 };
const desktopSpecs = /(round|season|today|shots|selftest|blur|failures)\.spec\.ts/;
// Browsers refuse the Fetch standard's "bad ports" (https://fetch.spec.whatwg.org/#port-blocking), and WebKit doesn't
// even fail the load, so every test would sit out its timeout. These are the ones from 1024 up.
const BAD_PORTS = [1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080];
// Several checkouts share one machine, so every run serves its own build and never reuses a server already on the
// port: that server would be another checkout's build. UE_E2E_PORT lets parallel runs use separate ports.
const port = Number(process.env.UE_E2E_PORT || 4173);

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`UE_E2E_PORT must be a port from 1024 to 65535, not "${process.env.UE_E2E_PORT}".`);
if (BAD_PORTS.includes(port)) throw new Error(`Browsers block port ${port} (a Fetch "bad port"; WebKit never loads it). Choose another UE_E2E_PORT, such as 4191.`);
const origin = `http://localhost:${port}/`;
// In WebKit a trace's screencast and DOM snapshots made the page's frames three times slower, which pushed the long
// rounds toward their timeouts under load. WebKit's traces keep the steps and their timings, plus one screenshot when a
// test fails. Edge's traces keep everything, except the speed test's, which speed.spec.ts makes light in both engines.
const lightTrace = {
  trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false },
  screenshot: 'only-on-failure',
} as const;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port}`,
    url: origin,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    // Draws Edge's native reference for the catcher test (blur.spec.ts) at each size and density of the projects that
    // depend on it, once per run and in a worker of its own: launched from inside the test, that Edge stalled in
    // WebKit's worker. Playwright runs it, and the projects without dependencies, before the desktop projects.
    { name: 'native-reference', testMatch: /native-reference\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...edge } },
    { name: 'desktop-edge', testMatch: desktopSpecs, dependencies: ['native-reference'], use: { ...devices['Desktop Chrome'], ...edge, viewport: desktop } },
    { name: 'desktop-webkit', testMatch: desktopSpecs, dependencies: ['native-reference'], use: { ...devices['Desktop Safari'], viewport: desktop, ...lightTrace } },
    // The speed test times a live pitch's frames against the mockup's in the same engine. Copies of it side by side, as
    // --repeat-each runs them, loaded each other's windows; the port does more script per frame than the mockup, so it
    // slowed more and failed the bound. Each engine runs its copies one at a time.
    { name: 'speed-edge', testMatch: /speed\.spec\.ts/, workers: 1, use: { ...devices['Desktop Chrome'], ...edge, viewport: desktop } },
    { name: 'speed-webkit', testMatch: /speed\.spec\.ts/, workers: 1, use: { ...devices['Desktop Safari'], viewport: desktop, ...lightTrace } },
    { name: 'iphone', testMatch: /phone\.spec\.ts/, use: { ...devices['iPhone 13'], ...lightTrace } },
    { name: 'pixel', testMatch: /phone\.spec\.ts/, use: { ...devices['Pixel 7'], ...edge } },
    { name: 'parity', testMatch: /parity\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...edge } },
  ],
});
