import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: 'on-first-retry',
  },
  // The two widths the design canvas is drawn at.
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  // Test the production bundle, so self-hosted assets are exercised as shipped.
  webServer: {
    command: `pnpm build && pnpm preview --port ${String(port)} --strictPort`,
    port,
    reuseExistingServer: !isCI,
  },
});
