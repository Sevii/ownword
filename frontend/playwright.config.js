import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 5004', url: 'http://127.0.0.1:5004', reuseExistingServer: false },
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.OW_URL ?? 'http://127.0.0.1:5004',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    // Request stubs (page.route) don't see requests from pages a service worker
    // controls in WebKit, so tests run without one; the offline test opts back in.
    serviceWorkers: 'block',
  },
  // The supported-browser matrix (M6.1). Desktop engines run everything; phones run the
  // flows that matter on a small touch screen (tests/e2e/mobile.spec.js and the layout checks).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } }, testIgnore: /mobile\.spec\.js/u },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1400, height: 900 } }, testIgnore: /mobile\.spec\.js/u },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 } }, testIgnore: /mobile\.spec\.js/u },
    { name: 'android', use: { ...devices['Pixel 7'] }, testMatch: /(mobile|layout)\.spec\.js/u },
    { name: 'iphone', use: { ...devices['iPhone 14'] }, testMatch: /(mobile|layout)\.spec\.js/u },
  ],
});
