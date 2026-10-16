import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:4318',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
  webServer: {
    command: 'node dist/server/index.js',
    url: 'http://127.0.0.1:4318/api/bootstrap',
    env: { PORT: '4318', TANDEM_DATA_DIR: join(tmpdir(), 'tandem-browser', randomUUID()) },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
