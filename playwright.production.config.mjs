import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: ['knowledge-graph.spec.mjs', 'knowledge-graph-native.spec.mjs'],
  outputDir: 'test-results-production',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'npx wrangler dev --config dist/server/wrangler.json --port 4174 --ip 127.0.0.1',
    url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 120_000,
  },
});
