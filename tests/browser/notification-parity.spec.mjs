import { test, expect } from '@playwright/test';
import { setup, disabledTelegram, disabledWebhook, expectToken } from './fixtures.mjs';

test.describe.configure({ timeout: 60_000 });

const telegram = {
  ...disabledTelegram,
  status: 'CONNECTED',
  enabled: true,
  telegram_username: 'fixture',
};
const webhook = {
  ...disabledWebhook,
  enabled: true,
  url: 'https://client.example.com/original',
  secret_configured: true,
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const services = [
  {
    name: 'Telegram',
    path: '/v1/user/telegram-notifications',
    selector: '[aria-labelledby="notification-settings-title"]',
    settings: telegram,
    failure: 'Telegram notification settings could not be loaded.',
    saved: 'Notification preferences saved.',
    disconnect: 'Disconnect',
    confirmation: 'Confirm disconnect',
    async edit(panel) {
      await panel.getByRole('button', { name: 'Russian', exact: true }).click();
      await panel.getByLabel(/Approved recommendations/).check();
    },
    async assertEdited(panel) {
      await expect(panel.getByRole('button', { name: 'Russian', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByLabel(/Approved recommendations/)).toBeChecked();
    },
    async assertReset(panel) {
      await expect(panel.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByLabel(/Approved recommendations/)).not.toBeChecked();
    },
    save: 'Save preferences',
  },
  {
    name: 'Webhook',
    path: '/v1/user/recommendation-webhook',
    selector: '[aria-labelledby="webhook-settings-title"]',
    settings: webhook,
    failure: 'Webhook settings could not be loaded.',
    saved: 'Webhook settings saved.',
    disconnect: 'Disconnect webhook',
    confirmation: 'Confirm disconnect webhook',
    async edit(panel) {
      await panel.getByLabel(/Webhook URL/).fill('https://client.example.com/draft');
      await panel.getByLabel(/Signing secret/).fill('draft-secret');
    },
    async assertEdited(panel) {
      await expect(panel.getByLabel(/Webhook URL/)).toHaveValue('https://client.example.com/draft');
    },
    async assertReset(panel) {
      await expect(panel.getByLabel(/Webhook URL/)).toHaveValue(webhook.url);
      await expect(panel.getByLabel(/Signing secret/)).toHaveValue('');
      await expect(panel.getByLabel('Clear signing secret')).not.toBeChecked();
    },
    save: 'Save webhook',
  },
];

async function expectReady(panel, service) {
  // A cold development server can expose the SSR skeleton while its client
  // modules are still loading. Wait for the settings action before interacting.
  await expect(panel.getByRole('button', { name: service.save, exact: true })).toBeVisible({ timeout: 30_000 });
}

for (const service of services) {
  test(`${service.name} refresh failure retains loaded settings and unsaved drafts`, async ({ page }) => {
    let failRefresh = false;
    await setup(page, {
      token: 'fixture-token', telegram, webhook,
      respond: entry => failRefresh && entry.path === service.path && entry.method === 'GET'
        ? { status: 503, json: {} } : undefined,
    });
    await page.goto('/dashboard/notifications');
    const panel = page.locator(service.selector);
    await expectReady(panel, service);
    await service.edit(panel);
    failRefresh = true;
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(service.failure);
    await service.assertEdited(panel);
    if (service.name === 'Webhook') await expect(panel.getByLabel(/Signing secret/)).toHaveValue('draft-secret');
    await expect(panel.getByLabel('Loading notification settings', { exact: true })).toHaveCount(0);
    await expectToken(page, 'fixture-token');
  });

  test(`${service.name} successful refresh resets drafts and disconnect confirmation`, async ({ page }) => {
    await setup(page, { token: 'fixture-token', telegram, webhook });
    await page.goto('/dashboard/notifications');
    const panel = page.locator(service.selector);
    await expectReady(panel, service);
    await service.edit(panel);
    if (service.name === 'Webhook') await panel.getByLabel('Clear signing secret').check();
    await panel.getByRole('button', { name: service.disconnect, exact: true }).click();
    await expect(panel.getByRole('button', { name: service.confirmation, exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await service.assertReset(panel);
    await expect(panel.getByRole('button', { name: service.confirmation, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: service.disconnect, exact: true })).toBeVisible();
  });

  test(`${service.name} save cancels an older refresh before applying its result`, async ({ page }) => {
    const stale = deferred();
    let reads = 0;
    let cancelled = false;
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === service.path) cancelled = true;
    });
    const fixture = await setup(page, {
      token: 'fixture-token', telegram, webhook,
      respond: async entry => {
        if (entry.path === service.path && entry.method === 'GET' && ++reads > 1) {
          await stale.promise;
          return { json: service.settings };
        }
      },
    });
    await page.goto('/dashboard/notifications');
    const panel = page.locator(service.selector);
    await expectReady(panel, service);
    await service.edit(panel);
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => reads).toBe(2);
    await panel.getByRole('button', { name: service.save, exact: true }).click();
    await expect(panel.getByText(service.saved, { exact: true })).toBeVisible();
    stale.resolve();
    await expect.poll(() => cancelled).toBe(true);
    await service.assertEdited(panel);
    expect(fixture.requests.filter(entry => entry.path === service.path && entry.method === 'PATCH')).toHaveLength(1);
    await expectToken(page, 'fixture-token');
  });

  test(`${service.name} late desktop refresh cannot restore settings after logout`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(({ path, settings, telegram, webhook }) => {
      let reads = 0;
      window.penelopaDesktop = {
        version: 1,
        auth: { state: async () => ({ authenticated: false }), signOut: async () => {} },
        openConnection: async () => {},
        request: async request => {
          if (request.path === path) {
            if (++reads > 1) await new Promise(resolve => { window.__releaseNotificationRead = resolve; });
            return { status: 200, data: settings };
          }
          return { status: 200, data: request.path.includes('telegram') ? telegram : webhook };
        },
      };
    }, { path: service.path, settings: service.settings, telegram, webhook });
    await page.goto('/dashboard/notifications');
    const panel = page.locator(service.selector);
    await expectReady(panel, service);
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__releaseNotificationRead)).toBe('function');
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.evaluate(() => window.__releaseNotificationRead());
    await expect(page.getByRole('button', { name: 'Open Connection', exact: true })).toBeVisible();
    await expect(page.locator(service.selector)).toHaveCount(0);
    await expectToken(page, null);
  });
}

test('Webhook empty mutation responses reload settings and clear sensitive drafts', async ({ page }) => {
  let settings = { ...disabledWebhook };
  const { requests } = await setup(page, {
    token: 'fixture-token',
    respond: entry => {
      if (entry.path !== '/v1/user/recommendation-webhook') return;
      if (entry.method === 'PATCH') {
        settings = { ...settings, enabled: entry.body.enabled, url: entry.body.url, secret_configured: Boolean(entry.body.secret) };
        return { status: 204 };
      }
      if (entry.method === 'DELETE') {
        settings = { ...disabledWebhook };
        return { status: 204 };
      }
      return { json: settings };
    },
  });
  await page.goto('/dashboard/notifications');
  const panel = page.locator('[aria-labelledby="webhook-settings-title"]');
  await panel.getByLabel('Enable webhook delivery').check();
  await panel.getByLabel(/Webhook URL/).fill('https://client.example.com/saved');
  await panel.getByLabel(/Signing secret/).fill('synthetic-secret');
  await panel.getByRole('button', { name: 'Save webhook', exact: true }).click();
  await expect(panel.getByText('Webhook settings saved.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel(/Signing secret/)).toHaveValue('');
  await expect(panel.getByLabel('Clear signing secret')).toBeVisible();
  await panel.getByRole('button', { name: 'Disconnect webhook', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm disconnect webhook', exact: true }).click();
  await expect(panel.getByText('Webhook disconnected.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel(/Webhook URL/)).toHaveValue('');
  await expect(panel.getByLabel('Clear signing secret')).toHaveCount(0);
  expect(requests.filter(entry => entry.path === '/v1/user/recommendation-webhook').map(entry => entry.method))
    .toEqual(['GET', 'PATCH', 'GET', 'DELETE', 'GET']);
});

test('Telegram event validation describes the affected choices and announces a successful save', async ({ page }) => {
  const { requests } = await setup(page, { token: 'fixture-token', telegram });
  await page.goto('/dashboard/notifications');
  const panel = page.locator(services[0].selector);
  await expectReady(panel, services[0]);
  const choices = panel.getByRole('group', { name: 'Notification types', exact: true });
  await choices.getByLabel(/New recommendations/).uncheck();
  await panel.getByRole('button', { name: 'Save preferences', exact: true }).click();
  const feedback = panel.locator('#telegram-settings-feedback');
  await expect(feedback).toHaveAttribute('role', 'alert');
  await expect(feedback).toHaveText('Choose at least one notification type.');
  await expect(choices).toHaveAttribute('aria-invalid', 'true');
  for (const input of await choices.getByRole('checkbox').all()) {
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription('Choose at least one notification type.');
  }
  expect(requests.filter(entry => entry.path === services[0].path && entry.method === 'PATCH')).toHaveLength(0);
  await choices.getByLabel(/New recommendations/).check();
  await expect(choices).not.toHaveAttribute('aria-invalid', 'true');
  await panel.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(feedback).toHaveText('Notification preferences saved.');
  await expect(feedback).toHaveAttribute('role', 'status');
  await expect(feedback).toHaveAttribute('aria-live', 'polite');
  await expect(feedback).toHaveAttribute('aria-atomic', 'true');
});

test('Webhook field guidance and URL validation remain associated through a successful save', async ({ page }) => {
  const { requests } = await setup(page, { token: 'fixture-token' });
  await page.goto('/dashboard/notifications');
  const panel = page.locator(services[1].selector);
  await expectReady(panel, services[1]);
  const url = panel.getByLabel('Webhook URL', { exact: true });
  await expect(url).toHaveAccessibleName('Webhook URL');
  await expect(panel.getByLabel('Signing secret', { exact: true })).toHaveAccessibleName('Signing secret');
  await expect(url).toHaveAccessibleDescription('Use an absolute http or https URL.');
  await expect(panel.getByLabel(/Signing secret/)).toHaveAccessibleDescription('Adds timestamped HMAC headers when configured.');
  await panel.getByLabel('Enable webhook delivery').check();
  await url.fill('https://user:pass@example.com/hook');
  await panel.getByRole('button', { name: 'Save webhook', exact: true }).click();
  const feedback = panel.locator('#webhook-settings-feedback');
  await expect(feedback).toHaveAttribute('role', 'alert');
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await expect(url).toHaveAccessibleDescription('Use an absolute http or https URL. Webhook URL must not include username or password.');
  expect(requests.filter(entry => entry.path === services[1].path && entry.method === 'PATCH')).toHaveLength(0);
  await url.fill('https://client.example.com/saved');
  await expect(url).not.toHaveAttribute('aria-invalid', 'true');
  await expect(url).toHaveAccessibleDescription('Use an absolute http or https URL.');
  await panel.getByRole('button', { name: 'Save webhook', exact: true }).click();
  await expect(feedback).toHaveText('Webhook settings saved.');
  await expect(feedback).toHaveAttribute('role', 'status');
  await expect(feedback).toHaveAttribute('aria-live', 'polite');
  await expect(feedback).toHaveAttribute('aria-atomic', 'true');
});
