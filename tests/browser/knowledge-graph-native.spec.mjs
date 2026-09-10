import { test, expect, _electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('native Electron renders the production graph through the production preload', async ({}, testInfo) => {
  test.skip(!process.env.PENELOPA_TEST_ELECTRON, 'Set PENELOPA_TEST_ELECTRON to the pinned Electron executable.');
  test.setTimeout(90_000);
  const application = await _electron.launch({ executablePath: process.env.PENELOPA_TEST_ELECTRON, args: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-graph-harness.cjs')], timeout: 30_000 });
  try {
    const page = await application.firstWindow();
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.goto(`${testInfo.project.use.baseURL}/dashboard/knowledge-graph`);
    await expect(page.locator('.kg-count')).toHaveText('4 entities · 3 connections');
    await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    expect(await page.evaluate(() => ({ isolated: typeof window.require === 'undefined' && typeof window.process === 'undefined', capable: window.penelopaDesktop.capabilities.knowledgeGraphRead }))).toEqual({ isolated: true, capable: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Latest', exact: true }).click();
    await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
    await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(page.locator('.kg-canvas')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('native-graph.png'), fullPage: true });
  } finally { await application.close(); }
});
