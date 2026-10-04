import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';
import { eventId, sessionId, transcriptResponse } from './transcript-fixtures.mjs';

const detail = `/dashboard/sessions/${sessionId}`;

async function prepare(page) {
  return setup(page, {
    token: 'fixture-token',
    respond: entry => entry.path.startsWith('/v2/') ? transcriptResponse(entry) : undefined,
  });
}

test('native mobile inspector keeps keyboard focus inside its modal and restores the event', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.goto(detail);
  const selected = page.locator('.event-row button').nth(1);
  await selected.click();
  const dialog = page.getByRole('dialog', { name: 'Event detail' });
  await expect(dialog.locator('.inspector-markdown')).toContainText('I’ll start');
  await expect(dialog).toHaveJSProperty('open', true);
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);

  const first = dialog.getByRole('button', { name: 'Close details' });
  const last = dialog.locator('summary');
  await last.focus();
  await page.keyboard.press('Tab');
  // Chromium's native dialog cycle may visit browser chrome between the last
  // and first controls; the document reports BODY during that native step.
  if (await page.evaluate(() => document.activeElement === document.body)) {
    await page.keyboard.press('Tab');
  }
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  if (await page.evaluate(() => document.activeElement === document.body)) {
    await page.keyboard.press('Shift+Tab');
  }
  await expect(last).toBeFocused();

  await page.evaluate(() => document.querySelector('.event-row button').focus());
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(selected).toBeFocused();
  await expect(page).not.toHaveURL(/event=/);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('selected inspector switches at 959 and 960 pixels without losing its event', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await prepare(page);
  await page.goto(detail);
  const selected = page.locator('.event-row button').nth(2);
  await selected.click();
  const pane = page.getByRole('complementary', { name: 'Event detail' });
  await expect(pane.locator('.inspector-code')).toContainText('rg --files');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const selectedUrl = page.url();

  await page.setViewportSize({ width: 959, height: 900 });
  const dialog = page.getByRole('dialog', { name: 'Event detail' });
  await expect(dialog.locator('.inspector-code')).toContainText('rg --files');
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
  await expect(pane).toHaveCount(0);
  await expect(page).toHaveURL(selectedUrl);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  await page.setViewportSize({ width: 960, height: 900 });
  await expect(pane.locator('.inspector-code')).toContainText('rg --files');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(selectedUrl);
  await expect(selected).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(pane).toHaveCount(0);
});

test('timeline arrow keys keep event selection and focus together at row boundaries', async ({ page }) => {
  await prepare(page);
  await page.goto(detail);
  const rows = page.locator('.event-row button');
  await expect(rows).toHaveCount(100);
  await rows.nth(1).click();
  await rows.nth(1).press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(new RegExp(`event=${eventId(3)}`));
  await expect(page.locator('.inspector-code')).toContainText('rg --files');

  await rows.nth(2).press('ArrowUp');
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(new RegExp(`event=${eventId(2)}`));
  await rows.nth(1).press('ArrowUp');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await rows.first().press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`event=${eventId(1)}`));

  await rows.last().click();
  await rows.last().press('ArrowDown');
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(new RegExp(`event=${eventId(100)}`));
});
