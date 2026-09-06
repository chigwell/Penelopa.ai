import { test, expect } from '@playwright/test';
import { setup, signIn, expectToken, recommendation, NOW } from './fixtures.mjs';

test('dashboard loads the same endpoints, paginates, expands, copies and signs out', async ({ page }) => {
  const { requests } = await setup(page);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await expectToken(page, 'fixture-token');
  expect(requests.slice(0, 3).map(r => r.path).sort()).toEqual([
    '/v1/admin/stats/daily-activity?days=30', '/v1/admin/stats/summary', '/v1/hermes/recommendations?page=1&page_size=10',
  ]);
  expect(requests.every(r => r.authorization === 'Bearer fixture-token')).toBe(true);
  const tokens = page.getByRole('button', { name: 'Tokens', exact: true });
  await tokens.click(); await expect(tokens).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /Keep verification repeatable script/ }).click();
  await expect(page.locator('.recommendation-inline-detail')).toContainText('Repeatable checks');
  await page.getByRole('button', { name: `Copy ${recommendation.title}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toBe(recommendation.report_markdown);
  await page.getByRole('button', { name: 'Next recommendations page' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.locator('.recommendation-inline-detail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByLabel('Access token')).toBeVisible(); await expectToken(page, null);
});

for (const route of ['/dashboard', '/dashboard/notifications']) {
  test(`${route} consumes initial token hashes and hash changes`, async ({ page }) => {
    await setup(page);
    await page.goto(`${route}?keep=1#token=first-token`);
    await expectToken(page, 'first-token'); await expect(page).toHaveURL(new RegExp(`${route}\\?keep=1$`));
    await page.evaluate(() => { location.hash = 'token=second-token'; });
    await expectToken(page, 'second-token');
  });
}

test('detail ignores hash tokens and distinguishes 404 from authentication failure', async ({ page }) => {
  let status = 404;
  const { requests } = await setup(page, { respond: entry => entry.path.includes('/recommendations/') ? { status, json: { detail: 'fixture' } } : null });
  await page.goto('/dashboard/recommendations/rec-1#token=ignored');
  await expect(page.getByLabel('Access token')).toBeVisible(); expect(requests).toHaveLength(0);
  await page.getByLabel('Access token').fill('fixture-token'); await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unavailable.' })).toBeVisible();
  await expect(page.getByText('This recommendation is no longer available.')).toBeVisible(); await expectToken(page, null);
  status = 401; await page.reload();
  await page.getByLabel('Access token').fill('bad-token'); await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('That access token is not valid.')).toBeVisible();
});

test('dashboard failure does not persist a submitted token', async ({ page }) => {
  await setup(page, { respond: entry => entry.path.endsWith('/summary') ? { status: 503, json: {} } : null });
  await signIn(page);
  await expect(page.getByText('Dashboard data is unavailable. Try again shortly.')).toBeVisible();
  await expectToken(page, null);
});

test('theme persists across pages and homepage copies both install commands', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByLabel('Public usage totals')).toContainText('150K');
  await page.getByRole('button', { name: 'Switch to dark theme' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Copy command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toBe('curl -fsSL https://penelopa.ai/script | sh');
  await page.getByRole('tab', { name: 'Win', exact: true }).click();
  await page.getByRole('button', { name: /Copy command|Copied/ }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toContain('Invoke-WebRequest');
  await page.goto('/dashboard'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('clipboard fallback preserves copied text and feedback', async ({ page }) => {
  await setup(page, { token: 'fixture-token' });
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async () => { throw Error('denied'); };
    document.execCommand = command => { window.__fallbackCopy = { command, text: document.querySelector('textarea')?.value }; return true; };
  });
  await page.goto('/dashboard/recommendations/rec-1');
  await page.getByRole('button', { name: 'Copy recommendation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__fallbackCopy)).toEqual({ command: 'copy', text: recommendation.report_markdown });
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('desktop route gates offer Connection and never store an installed credential', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    window.__connectionOpened = 0;
    window.penelopaDesktop = { version: 1, auth: { state: async () => ({ authenticated: false }), signOut: async () => {} },
      request: async () => ({ status: 401, data: {} }), openConnection: async () => { window.__connectionOpened++; } };
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open Connection' }).click();
  expect(await page.evaluate(() => window.__connectionOpened)).toBe(1);
  await expect(page.getByLabel('Access token')).toHaveCount(0); await expectToken(page, null);
});

test('Telegram saves before generating links and keeps two-step disconnect', async ({ page }) => {
  const fixture = await setup(page, { token: 'fixture-token' });
  await page.goto('/dashboard/notifications');
  await page.getByRole('button', { name: 'Russian', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Telegram', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open Telegram', exact: true })).toHaveAttribute('href', 'https://t.me/fixture_bot?start=synthetic');
  const writes = fixture.requests.filter(r => r.method !== 'GET');
  expect(writes.map(r => r.method)).toEqual(['PATCH', 'POST']);
  expect(writes[0].body).toEqual({ enabled: true, language: 'ru', notification_types: ['recommendation_created'] });
  fixture.setTelegram({ status: 'CONNECTED', telegram_username: 'fixture_user', link_expires_at: null });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  expect(fixture.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect(page.getByText('Telegram disconnected.')).toBeVisible();
  expect(fixture.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
});

test('pending Telegram polls immediately and every two seconds, stopping at expiry', async ({ page }) => {
  const { requests } = await setup(page, { token: 'fixture-token', telegram: { status: 'PENDING', enabled: true, link_expires_at: new Date(NOW.getTime() + 6000).toISOString() } });
  await page.clock.install({ time: NOW });
  await page.goto('/dashboard/notifications');
  const count = () => requests.filter(r => r.path === '/v1/user/telegram-notifications').length;
  await expect.poll(count).toBe(2);
  await page.clock.runFor(2000); await expect.poll(count).toBe(3);
  await page.clock.runFor(2000); await expect.poll(count).toBe(4);
  await page.clock.runFor(2000); await expect(page.getByText('Setup link expired', { exact: true })).toBeVisible();
  const last = count(); await page.clock.runFor(10000); expect(count()).toBe(last);
});

test('notifications persist submitted auth before a failed settings request', async ({ page }) => {
  await setup(page, { respond: () => ({ status: 503, json: {} }) });
  await signIn(page, '/dashboard/notifications');
  await expect(page.getByText('Telegram notification settings could not be loaded.')).toBeVisible();
  await expectToken(page, 'fixture-token');
});

test('Telegram PATCH 204 reloads settings before creating a setup link', async ({ page }) => {
  const { requests } = await setup(page, { token: 'fixture-token', respond: entry => entry.method === 'PATCH' ? { status: 204 } : null });
  await page.goto('/dashboard/notifications');
  await page.getByRole('button', { name: 'Connect Telegram', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open Telegram', exact: true })).toBeVisible();
  const start = requests.findIndex(entry => entry.method === 'PATCH');
  expect(requests.slice(start, start + 3).map(entry => entry.method)).toEqual(['PATCH', 'GET', 'POST']);
});

test('Telegram unavailable pending setup does not poll and auth expiry locks the route', async ({ page }) => {
  let expired = false;
  const { requests } = await setup(page, { token: 'fixture-token', telegram: { status: 'PENDING', setup_available: false },
    respond: () => expired ? { status: 403, json: {} } : null });
  await page.clock.install({ time: NOW });
  await page.goto('/dashboard/notifications');
  await expect(page.getByRole('button', { name: 'Generate new link' })).toBeDisabled();
  await page.clock.runFor(10_000); expect(requests).toHaveLength(1);
  expired = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Your access token has expired. Enter it again.')).toBeVisible(); await expectToken(page, null);
});
