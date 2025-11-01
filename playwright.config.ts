import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  globalSetup: join(__dirname, 'tests/e2e/global-setup.ts'),
  use: {
    baseURL: 'http://localhost:3030',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run src/index.ts',
    url: 'http://localhost:3030',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
    env: {
      FORGE_DATA_DIR: '.forge-e2e',
      FORGE_PORT: '3030',
      FORGE_MERGE_PASSWORD: 'test-password',
    },
  },
});
