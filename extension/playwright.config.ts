import { defineConfig } from '@playwright/test';

// End-to-end tests load the real unpacked extension (dist-test/) into
// Playwright's bundled Chromium. Branded Google Chrome 137+ no longer
// supports --load-extension, so Chromium is used for automation.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/serve-fixtures.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    stdout: 'pipe',
  },
});
