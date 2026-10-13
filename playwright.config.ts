import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

if (process.env.UI_TEST_URL !== undefined) {
  throw new Error('UI_TEST_URL is not supported; Playwright must test its owned frontend.');
}

const runDirectory = resolve(process.env.RUN_DIR ?? '.runs/browser');
const apiPort = process.env.TEST_API_PORT ?? '14310';
const uiPort = process.env.TEST_UI_PORT ?? '15173';
const databasePath = resolve(runDirectory, 'acceptance.sqlite');
const instanceId = process.env.TEST_WORKER_INDEX === undefined
  ? `acceptance-${randomUUID()}` : process.env.ISSUE_TRACKER_OWNED_TEST_INSTANCE;
if (!instanceId) throw new Error('Missing owned Playwright launch identity.');
process.env.ISSUE_TRACKER_OWNED_TEST_INSTANCE = instanceId;
export default defineConfig({
  testDir: './acceptance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: resolve(runDirectory, 'browser-results.json') }], ['html', { outputFolder: resolve(runDirectory, 'report'), open: 'never' }]],
  outputDir: resolve(runDirectory, 'artifacts'),
  use: { baseURL: `http://127.0.0.1:${uiPort}`, trace: 'on', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', metadata: { instanceId, databasePath }, use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node node_modules/tsx/dist/cli.mjs src/server.ts', url: `http://127.0.0.1:${apiPort}/api/health`, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }, timeout: 30000, env: { DB_PATH: databasePath, API_PORT: apiPort, UI_PORT: uiPort, INSTANCE_ID: instanceId } },
    { command: 'node node_modules/vite/bin/vite.js', url: `http://127.0.0.1:${uiPort}`, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }, timeout: 30000, env: { API_PORT: apiPort, UI_PORT: uiPort } },
  ],
});
