import { test, expect } from '@playwright/test';
import { setupGraphs } from './graph-fixtures.mjs';

for (const theme of ['light', 'dark']) for (const width of [390, 768, 1024, 1440]) {
  test(`knowledge explorer ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupGraphs(page, { theme });
    await page.goto('/dashboard/knowledge-graph');
    await expect(page.getByRole('heading', { name: 'Entities & connections' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`knowledge-${theme}-${width}.png`, { fullPage: true });
    await page.getByRole('button', { name: 'Dashboard 2 connections' }).click();
    await expect(page.getByLabel('Knowledge detail')).toBeVisible();
    await expect(page).toHaveScreenshot(`knowledge-inspector-${theme}-${width}.png`, { fullPage: true });
  });
}
