import { test, expect } from '@playwright/test';
import { setup, recommendation, summary, expectToken } from './fixtures.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function unsupportedSessions(entry) {
  return entry.path.startsWith('/v2/') ? { status: 404, json: { detail: 'Not available in this fixture' } } : null;
}

test('initial dashboard shows a stable skeleton, without flashing the access form', async ({ page }) => {
  test.setTimeout(60_000);
  const ready = deferred();
  const { requests } = await setup(page, { token: 'fixture-token', respond: async entry => {
    if (entry.path.endsWith('/stats/summary')) await ready.promise;
    return unsupportedSessions(entry);
  } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  await expect(page.getByLabel('Loading dashboard', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveCount(0);
  expect(await page.locator('.skeleton').first().evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
  // SSR can expose the skeleton before a cold dev server finishes client modules.
  await expect.poll(() => requests.some(entry => entry.path.endsWith('/stats/summary')), { timeout: 30_000 }).toBe(true);
  ready.resolve();
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await expect(page.getByLabel('Loading dashboard', { exact: true })).toHaveCount(0);
});

test('refresh preserves the dashboard and its credentials on temporary failure', async ({ page }) => {
  const refreshed = deferred();
  let summaries = 0;
  await setup(page, { token: 'fixture-token', respond: async entry => {
    if (entry.path.endsWith('/stats/summary') && ++summaries > 1) {
      await refreshed.promise;
      return { status: 503, json: {} };
    }
    return unsupportedSessions(entry);
  } });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByText('Updating', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveCount(0);
  refreshed.resolve();
  await expect(page.getByText('Dashboard data is unavailable. Try again shortly.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await expectToken(page, 'fixture-token');
});

test('a delayed dashboard response cannot reopen the account after logout', async ({ page }) => {
  const refreshed = deferred();
  let summaries = 0;
  await setup(page, { token: 'fixture-token', respond: async entry => {
    if (entry.path.endsWith('/stats/summary') && ++summaries > 1) {
      await refreshed.promise;
      return { json: { ...summary, saved_sessions_count: 999 } };
    }
    return unsupportedSessions(entry);
  } });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByText('Updating', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  refreshed.resolve();
  await expect(page.getByLabel('Access token')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toHaveCount(0);
  await expectToken(page, null);
});

test('switching expanded recommendations ignores an older detail response', async ({ page }) => {
  const first = deferred();
  await setup(page, { token: 'fixture-token', respond: async entry => {
    if (entry.path === '/v1/hermes/recommendations?page=1&page_size=10') return { json: {
      items: [recommendation, { ...recommendation, id: 'rec-2', title: 'Second idea' }], page: 1, page_size: 10, total: 2,
    } };
    if (entry.path === '/v1/hermes/recommendations/rec-1') {
      await first.promise;
      return { json: recommendation };
    }
    if (entry.path === '/v1/hermes/recommendations/rec-2') return { json: { ...recommendation, id: 'rec-2', report_markdown: 'The second idea stays selected.' } };
    return unsupportedSessions(entry);
  } });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Keep verification repeatable script/ }).click();
  await expect(page.getByLabel('Loading details', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Second idea script/ }).click();
  await expect(page.locator('.recommendation-inline-detail')).toContainText('The second idea stays selected.');
  first.resolve();
  await expect(page.locator('.recommendation-inline-detail')).toContainText('The second idea stays selected.');
  await expect(page.getByRole('button', { name: /Second idea script/ })).toHaveAttribute('aria-expanded', 'true');
});

test('recommendation and notification loading keep their page context visible', async ({ page }) => {
  const detail = deferred();
  const notifications = deferred();
  await setup(page, { token: 'fixture-token', respond: async entry => {
    if (entry.path.startsWith('/v1/hermes/recommendations/')) await detail.promise;
    if (entry.path === '/v1/user/telegram-notifications') await notifications.promise;
    return unsupportedSessions(entry);
  } });
  await page.goto('/dashboard/recommendations/rec-1');
  await expect(page.getByLabel('Loading recommendation', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveCount(0);
  detail.resolve();
  await expect(page.getByRole('heading', { name: recommendation.title })).toBeVisible();
  await page.goto('/dashboard/notifications');
  await expect(page.getByRole('heading', { name: 'Notification settings.' })).toBeVisible();
  await expect(page.getByLabel('Loading notification settings', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveCount(0);
  notifications.resolve();
  await expect(page.getByRole('button', { name: 'Connect Telegram', exact: true })).toBeVisible();
});

test('a late desktop IPC response cannot restore a signed-out dashboard', async ({ page }) => {
  await setup(page);
  await page.addInitScript(({ summary, recommendation }) => {
    let summaries = 0;
    window.penelopaDesktop = {
      version: 1,
      auth: { state: async () => ({ authenticated: false }), signOut: async () => {} },
      openConnection: async () => {},
      request: async ({ path }) => {
        if (path.endsWith('/stats/summary')) {
          if (++summaries > 1) await new Promise(resolve => { window.__releaseDesktopSummary = resolve; });
          return { status: 200, data: summary };
        }
        if (path.includes('/daily-activity')) return { status: 200, data: [] };
        if (path.startsWith('/v1/hermes/recommendations?')) return { status: 200, data: { items: [recommendation], page: 1, page_size: 10, total: 1 } };
        if (path === '/v1/user/telegram-notifications') return { status: 200, data: { status: 'DISABLED', enabled: false, notification_types: [], language: 'en' } };
        if (path === '/v1/user/recommendation-webhook') return { status: 200, data: { enabled: false, url: null, secret_configured: false, notification_types: ['recommendation_approved'], created_at: '2026-09-06T12:00:00Z', updated_at: '2026-09-06T12:00:00Z' } };
        return { status: 404, data: {} };
      },
    };
  }, { summary, recommendation });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByText('Updating', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.evaluate(() => window.__releaseDesktopSummary());
  await expect(page.getByRole('button', { name: 'Open Connection' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your activity.' })).toHaveCount(0);
});

test('homepage statistics and GitHub counts show placeholders until data arrives', async ({ page }) => {
  await setup(page);
  const data = deferred();
  await page.route('**/api/public-stats', async route => {
    await data.promise;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.route('**/api/github-repo', async route => {
    await data.promise;
    await route.fulfill({ json: { stargazers_count: 123, html_url: 'https://github.com/chigwell/penelopa.ai' } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Public usage totals')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.stats-board .skeleton')).toHaveCount(7);
  await expect(page.locator('.github-stars-count')).toHaveAttribute('aria-busy', 'true');
  data.resolve();
  await expect(page.getByLabel('Public usage totals')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.github-stars-count')).toContainText('123');
});
