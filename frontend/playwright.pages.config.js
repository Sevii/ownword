import { defineConfig, devices } from '@playwright/test';

const base = process.env.OW_BASE_PATH || '/';
const origin = 'http://127.0.0.1:5005';
export default defineConfig({
  testDir: 'tests/pages',
  timeout: 60000,
  expect: { timeout: 15000 },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5005 --strictPort',
    url: `${origin}${base}`,
    reuseExistingServer: false,
  },
  use: { ...devices['Desktop Chrome'], baseURL: `${origin}${base}`, serviceWorkers: 'allow', trace: 'retain-on-failure' },
});
