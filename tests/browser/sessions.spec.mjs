import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';
import { events, eventId, session, sessionId, stepId, tail, transcriptResponse } from './transcript-fixtures.mjs';

async function prepare(page, respond) {
  return setup(page, { token: 'fixture-token', respond: async entry => entry.path.startsWith('/v2/') ? (await respond?.(entry)) || transcriptResponse(entry) : undefined });
}
const detail = `/dashboard/sessions/${sessionId}`;

test('library restores previous cursor after browser Back and filters actual agent source', async ({ page }) => {
  const { requests } = await prepare(page);
  await page.goto('/dashboard/sessions');
  await expect(page.locator('.session-row')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.session-row').first()).toContainText('Session page 2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.session-row').first()).toContainText('Session page 3');
  await page.goBack();
  await expect(page.locator('.session-row').first()).toContainText('Session page 2');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.session-row').first()).toContainText(session.first_user_message_preview);
  await page.getByLabel('Agent', { exact: true }).selectOption('claude-anthropic');
  await expect.poll(() => requests.some(request => request.path.includes('source=claude-anthropic'))).toBe(true);
  await expect(page).not.toHaveURL(/cursor=/);
});

test('timeline is bounded, exact tool details link to output, raw JSON and process evidence', async ({ page }) => {
  await prepare(page);
  await page.goto(detail);
  await expect(page.locator('.event-row')).toHaveCount(100);
  await page.locator('.event-row button').nth(2).click();
  await expect(page.getByRole('complementary', { name: 'Event detail' })).toBeVisible();
  await expect(page.locator('.inspector-code')).toContainText('rg --files');
  await page.locator('.inspector-related').getByRole('button', { name: 'Tool result' }).click();
  await expect(page).toHaveURL(new RegExp(eventId(4)));
  await expect(page.locator('.inspector-code')).toContainText('app/styles/foundations.css');
  await page.getByRole('button', { name: 'Source data', exact: true }).click();
  await expect(page.locator('.inspector-code')).toContainText('9007199254740996');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await page.locator('.process-timeline button').first().click();
  await expect(page).toHaveURL(new RegExp(stepId));
  await page.locator('.step-evidence').getByRole('button').first().click();
  await expect(page.locator('.inspector-code')).toContainText('rg --files');
});

test('mobile details trap focus, close with Escape and keep selected row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.goto(detail);
  await page.locator('.event-row button').nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Event detail' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.inspector-markdown')).toContainText('I’ll start');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.event-row button').nth(1)).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('search actor variants and unavailable process do not hide original events', async ({ page }) => {
  await prepare(page, entry => entry.path.includes('/timeline') ? { status: 404, json: { detail: 'Not ready' } } : undefined);
  await page.goto(detail);
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await expect(page.getByText('The process overview isn’t ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByLabel('Search session text').fill('All checks passed');
  await expect(page.locator('.event-row').first()).toContainText('exec_command');
  await expect(page.locator('.event-row').first()).toHaveClass(/tone-tool/);
});

test('long content is fetched in bounded fragments and retained data never becomes a token gate', async ({ page }) => {
  const { requests } = await prepare(page, entry => {
    if (entry.path.includes('/content/block-1')) return { json: { content_version: 'fixture-v1', text: entry.path.includes('cursor=chunk-2') ? 'Final fragment Ω.' : 'A'.repeat(16384), complete: entry.path.includes('cursor=chunk-2'), next_cursor: entry.path.includes('cursor=chunk-2') ? null : 'chunk-2' } };
  });
  await page.goto(`${detail}?event=${eventId(1)}`);
  await expect(page.locator('.inspector-code')).toContainText('AAAA');
  await page.getByRole('button', { name: 'Next content fragment' }).click();
  await expect(page.locator('.inspector-code')).toContainText('Final fragment Ω.');
  await expect(page.getByLabel('Access token')).toHaveCount(0);
  expect(requests.filter(entry => entry.path.includes('/content/')).every(entry => entry.path.includes('max_chars=16384'))).toBe(true);
});

test('storage 410 and expired content finish loading and preserve session metadata', async ({ page }) => {
  await prepare(page, entry => entry.path.includes('/content/') ? { status: 410, json: { detail: { code: 'event_payload_unavailable' } } } : undefined);
  await page.goto(`${detail}?event=${eventId(1)}`);
  await expect(page.getByText('The details are no longer stored.')).toBeVisible();
  await expect(page.getByRole('heading', { name: session.first_user_message_preview })).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveCount(0);
});

test('latest snapshot remains steady while reading and applies pending events on demand', async ({ page }) => {
  let updated = false;
  const appended = { ...events[124], id: eventId(126), event_seq_decimal: '9007199254741118', content_text: 'A newly delivered result.' };
  await prepare(page, entry => {
    if (!entry.path.includes('/events/tail')) return;
    if (!entry.path.includes('cursor=')) return { json: updated ? { ...tail, items: [...events.slice(-99), appended], history_cursor: 'before-27' } : tail };
    return { json: { ...tail, items: updated ? [appended] : [], history_cursor: updated ? 'before-27' : 'before-26' } };
  });
  await page.goto(detail);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect(page).toHaveURL(/at=latest/);
  await expect(page.locator('.event-row').first()).toContainText('10:00:25');
  await expect(page.locator('.event-row')).toHaveCount(100);
  const firstText = await page.locator('.event-row').first().innerText();
  updated = true;
  await expect(page.getByRole('button', { name: '1 new event', exact: true })).toBeVisible({ timeout: 12000 });
  expect(await page.locator('.event-row').first().innerText()).toBe(firstText);
  await expect(page.locator('.event-row').filter({ hasText: 'A newly delivered result.' })).toHaveCount(0);
  await page.getByRole('button', { name: '1 new event', exact: true }).click();
  await expect(page.locator('.event-row').last()).toContainText('A newly delivered result.');
});

test('old desktop keeps overview access and offers an update without v2 IPC', async ({ page }) => {
  await page.addInitScript(() => { window.penelopaDesktop = { version: 1, auth: { state: async () => ({ authenticated: true }), signOut: async () => {} }, request: async () => { throw new Error('v2 must not reach old desktop'); }, openConnection: async () => {} }; });
  await setup(page);
  await page.goto('/dashboard/sessions');
  await expect(page.getByText('A little update. A lot more detail.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
});

test('a directly linked late message block can return to the first blocks', async ({ page }) => {
  const { requests } = await prepare(page, entry => {
    if (entry.path.includes(`/events/${eventId(1)}`) && !entry.path.includes('/content/') && !entry.path.includes('/related')) {
      const response = transcriptResponse(entry);
      if (entry.path.includes('section_id=block-51')) response.json.sections = [{ ...response.json.sections[0], id: 'block-51', label: 'Message block 51' }, response.json.sections[1]];
      return response;
    }
  });
  await page.goto(`${detail}?event=${eventId(1)}&section=block-51`);
  await expect(page.getByRole('button', { name: 'Message block 51', exact: true })).toBeVisible();
  expect(requests.some(entry => entry.path.includes('section_id=block-51'))).toBe(true);
  await page.getByRole('button', { name: 'First message blocks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Message', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/section=/);
});

test('reparse invalidates the frozen latest window while follow is off', async ({ page }) => {
  let changed = false, resetSent = false;
  const replacement = { ...events[0], id: eventId(500), content_text: 'The reparsed current event.', event_seq_decimal: '9007199254741999' };
  await prepare(page, entry => {
    if (!entry.path.includes('/events/tail')) return;
    if (changed && !resetSent && entry.path.includes('cursor=')) { resetSent = true; return { json: { ...tail, items: [], reset_required: true } }; }
    if (!entry.path.includes('cursor=')) return { json: changed ? { ...tail, items: [replacement], tail_cursor: 'tail-reset', history_cursor: null } : tail };
    return { json: { ...tail, items: [], tail_cursor: changed ? 'tail-reset' : tail.tail_cursor, history_cursor: changed ? null : tail.history_cursor } };
  });
  await page.goto(`${detail}?at=latest`);
  await expect(page.locator('.event-row')).toHaveCount(100);
  changed = true;
  await expect(page.locator('.event-row')).toHaveCount(1, { timeout: 12000 });
  await expect(page.locator('.event-row')).toContainText('The reparsed current event.');
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('a replacement process analysis returns to its first page', async ({ page }) => {
  let changed = false;
  await prepare(page, entry => {
    if (entry.path.includes('/events/tail')) return { json: { ...tail, items: entry.path.includes('cursor=') ? [] : tail.items, analysis_run_id: changed ? '66666666-6666-4666-8666-666666666666' : tail.analysis_run_id } };
    if (entry.path.includes('/timeline') && entry.path.includes('after_step=99')) return { json: { ...transcriptResponse(entry).json, steps: [{ ...transcriptResponse(entry).json.steps[0], title: 'Old page 2 step', ordinal: 100 }] } };
  });
  await page.goto(`${detail}?view=process&after_step=99`);
  await expect(page.locator('.process-timeline')).toContainText('Old page 2 step');
  changed = true;
  await expect(page).not.toHaveURL(/after_step=/, { timeout: 12000 });
  await expect(page.locator('.process-timeline')).toContainText('Understand the existing dashboard');
});
