import { test, expect } from '@playwright/test';
import { setupGraphs } from './graph-fixtures.mjs';

for (const theme of ['light', 'dark']) for (const width of [390, 768, 1024, 1440]) {
  test(`knowledge explorer ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupGraphs(page, { theme });
    await page.goto('/dashboard/knowledge-graph');
    await expect(page.getByRole('heading', { name: 'Entities & connections' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toBeVisible();
    await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
    await expect(page).toHaveScreenshot(`knowledge-latest-${theme}-${width}.png`, { fullPage: true });
    await page.getByRole('button', { name: 'View all time' }).click();
    await expect(page.locator('.kg-count')).toHaveText('4 entities · 3 connections');
    await expect(page).toHaveScreenshot(`knowledge-all-time-${theme}-${width}.png`, { fullPage: true });
    await page.goto('/dashboard/knowledge-graph?mode=range&from=2026-09-02T00%3A00%3A00.000Z&to=2026-09-02T23%3A59%3A59.999Z');
    await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
    await expect(page).toHaveScreenshot(`knowledge-range-${theme}-${width}.png`, { fullPage: true });
    await page.getByRole('button', { name: 'View all time' }).click();
    await page.getByRole('button', { name: 'Dashboard 2 connections' }).click();
    await expect(page.getByLabel('Knowledge detail')).toBeVisible();
    await expect(page).toHaveScreenshot(`knowledge-inspector-${theme}-${width}.png`, { fullPage: true });
  });
}
