import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';

for (const theme of ['light', 'dark']) {
  for (const width of [1280, 390]) {
    for (const [name, route, ready] of [
      ['home', '/', 'Continuous improvement for AI agents.'],
      ['dashboard', '/dashboard', 'Your activity.'],
      ['report', '/dashboard/recommendations/rec-1', 'Keep verification repeatable'],
      ['telegram', '/dashboard/notifications', 'Telegram notifications.'],
      ['privacy', '/privacy', 'Privacy Policy'],
      ['terms', '/terms', 'Terms of Service'],
    ]) {
      test(`${name} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await setup(page, { token: 'fixture-token', theme });
        await page.goto(route);
        await expect(page.getByRole('heading', { name: ready, exact: true })).toBeVisible();
        if (name === 'dashboard') await expect(page.getByText('Loading notification settings...')).toHaveCount(0);
        if (name === 'telegram') await expect(page.getByRole('button', { name: 'Save preferences' })).toBeVisible();
        if (name === 'home') await expect(page.getByLabel('Public usage totals')).toContainText('150K');
        // A resolved route heading alone can still coexist with an image-fetch
        // development overlay. Never record that transient failure as a baseline.
        await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
        await expect(page.locator('vite-error-overlay')).toHaveCount(0);
        await expect(page).toHaveScreenshot(`${name}-${theme}-${width}.png`, { fullPage: true });
      });
    }
  }
}
