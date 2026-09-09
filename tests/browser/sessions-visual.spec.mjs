import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';
import { eventId, sessionId, stepId, transcriptResponse } from './transcript-fixtures.mjs';

for (const theme of ['light', 'dark']) for (const width of [390, 768, 1024, 1440]) {
  for (const [name, route] of [
    ['library', '/dashboard/sessions'],
    ['events', `/dashboard/sessions/${sessionId}`],
    ['inspector', `/dashboard/sessions/${sessionId}?event=${eventId(3)}`],
    ['process', `/dashboard/sessions/${sessionId}?view=process&step=${stepId}`],
  ]) test(`sessions ${name} ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await setup(page, { token: 'fixture-token', theme, respond: entry => entry.path.startsWith('/v2/') ? transcriptResponse(entry) : undefined });
    await page.goto(route);
    if (name === 'library') await expect(page.locator('.session-row')).toHaveCount(6);
    if (name === 'events') await expect(page.locator('.event-row')).toHaveCount(100);
    if (name === 'inspector') await expect(page.locator('.inspector-code')).toContainText('rg --files');
    if (name === 'process') await expect(page.locator('.step-evidence button')).toHaveCount(1);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page).toHaveScreenshot(`sessions-${name}-${theme}-${width}.png`, { fullPage: name === 'library' });
  });
}
