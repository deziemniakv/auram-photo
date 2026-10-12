import { defineConfig } from '@playwright/test';

/** End-to-end tests drive the built Electron app (run `pnpm build` first). */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
