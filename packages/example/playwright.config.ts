import { defineConfig, devices } from '@playwright/test';

// 여러 워크트리에서 E2E 를 동시에 돌릴 수 있게 포트를 바꿀 수 있다
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `NODE_ENV=production PORT=${PORT} node server.ts`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
