import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';
import { sessionId, transcriptResponse } from './transcript-fixtures.mjs';

const routes = [
  ['/dashboard', '.dashboard-title h1', '.dashboard-title > p'],
  ['/dashboard/recommendations/rec-1', '.recommendation-page-heading h1', '.recommendation-page-meta'],
  ['/dashboard/notifications', '.notification-page-heading h1', '.notifications-status-card dt'],
  ['/dashboard/sessions', '.session-library-heading h1', '.session-row-meta'],
  [`/dashboard/sessions/${sessionId}`, '.session-detail-heading h1', '.event-row-footer'],
];

for (const theme of ['light', 'dark']) {
  for (const width of [390, 640]) {
    test(`admin reflow and readable hierarchy ${theme} ${width}`, async ({ page }) => {
      // 640 CSS pixels also exercises the layout space of a 1280px window at 200% zoom.
      await page.setViewportSize({ width, height: 900 });
      await setup(page, { token: 'fixture-token', theme, respond: entry => entry.path.startsWith('/v2/') ? transcriptResponse(entry) : undefined });
      for (const [route, heading, metadata] of routes) {
        await page.goto(route);
        await expect(page.locator(heading)).toBeVisible();
        await expect(page.locator(metadata).first()).toBeVisible();
        const titleSize = await page.locator(heading).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(titleSize, `${route} heading size`).toBeGreaterThanOrEqual(32);
        expect(titleSize, `${route} heading size`).toBeLessThanOrEqual(48);
        expect(await page.locator(metadata).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)), `${route} metadata size`).toBeGreaterThanOrEqual(12);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${route} must keep horizontal scrolling inside bounded panes` }).toBe(true);
        if (route === '/dashboard') {
          const table = page.getByRole('region', { name: 'Recommendations table' });
          await table.focus();
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        }
        for (const button of await page.locator('.dashboard-topbar .icon-button').all()) {
          const box = await button.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
}

test('long report titles and code remain readable without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, { token: 'fixture-token', respond: entry => entry.path.includes('/hermes/recommendations/rec-1') ? {
    json: { id: 'rec-1', title: 'A very long recommendation title '.repeat(8), report_markdown: `## Verification\n\n\`\`\`sh\n${'long_command_argument_'.repeat(100)}\n\`\`\``, created_at: '2026-09-06T12:00:00Z', session_count: 2, project_key: 'long-project-name/'.repeat(15), result_type: 'recommendation' },
  } : undefined });
  await page.goto('/dashboard/recommendations/rec-1');
  await expect(page.locator('.recommendation-report pre')).toBeVisible();
  expect(await page.locator('.recommendation-report pre').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark']) {
  test(`long notification labels and failures reflow with readable contrast ${theme}`, async ({ page }) => {
    const message = 'Server_response_'.repeat(10);
    await page.setViewportSize({ width: 390, height: 900 });
    await setup(page, { token: 'fixture-token', theme,
      telegram: { enabled: true, status: 'CONNECTED', telegram_username: 'a'.repeat(32), telegram_chat_id: 123 },
      respond: entry => entry.path === '/v1/user/recommendation-webhook' && entry.method === 'PATCH' ? { status: 422, json: { detail: message } } : undefined,
    });
    await page.goto('/dashboard/notifications');
    await expect(page.locator('.notification-telegram-box h3')).toContainText('a'.repeat(32));
    const webhook = page.locator('.webhook-detail-panel');
    await webhook.getByLabel(/Webhook URL/).fill('https://client.example.com/hook');
    await webhook.getByRole('button', { name: 'Save webhook', exact: true }).click();
    const feedback = webhook.locator('.notification-form-message');
    await expect(feedback).toHaveText(message);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const colors = await feedback.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(document.querySelector('.dashboard-shell')).backgroundColor }));
    expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    const body = page.locator('.notification-telegram-box p').first();
    const surfaceColors = await body.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el.closest('.notification-telegram-box')).backgroundColor }));
    expect(contrast(surfaceColors.foreground, surfaceColors.background)).toBeGreaterThanOrEqual(4.5);
    for (const button of await page.locator('.notification-segmented-control button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  });
}

function contrast(foreground, background) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('a long selected project stays bounded and its popover follows the trigger', async ({ page }) => {
  const project = '/work/' + 'project_'.repeat(30);
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, { token: 'fixture-token', respond: entry => entry.path.startsWith('/v2/') ? transcriptResponse(entry) : undefined });
  await page.goto(`/dashboard/sessions?project=${encodeURIComponent(project)}`);
  const trigger = page.locator('.session-project-filter > button');
  await expect(trigger).toContainText('project_'.repeat(30));
  await expect(page.getByText('0 sessions on this page', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await trigger.click();
  await expect(page.getByPlaceholder('Find a project…')).toBeVisible();
  const triggerBox = await trigger.boundingBox(), popoverBox = await page.locator('.session-project-popover').boundingBox();
  expect(popoverBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(390);
});

test('narrow event controls and inspector tabs keep touch-sized targets', async ({ page }) => {
  let tailFailed = false;
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, { token: 'fixture-token', respond: entry => tailFailed && entry.path.includes('/events/tail') ? { status: 503, json: { detail: 'Temporarily unavailable' } } : entry.path.startsWith('/v2/') ? transcriptResponse(entry) : undefined });
  await page.goto(`/dashboard/sessions/${sessionId}`);
  await expect(page.locator('.event-row')).toHaveCount(100);
  await expect(page.locator('.session-live-state')).toContainText('Live updates');
  expect(await page.locator('.session-live-state').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  for (const control of await page.locator('.timeline-filters select, .timeline-filters input, .session-view-tabs button').all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.session-live-state')).toContainText('Paused');
  expect(await page.locator('.session-live-state').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.session-live-state')).toContainText('Live updates');
  tailFailed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.session-live-state')).toContainText('Reconnecting');
  expect(await page.locator('.session-live-state').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  await page.locator('.event-row > button').first().click();
  await expect(page.locator('dialog')).toBeVisible();
  for (const button of await page.locator('.inspector-tabs button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
