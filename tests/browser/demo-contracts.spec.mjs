import { test, expect } from '@playwright/test';
import { setup, NOW } from './fixtures.mjs';

async function advanceUntil(page, locator, assertion, limit = 100) {
  for (let i = 0; i < limit; i++) {
    if (await assertion(locator)) return;
    await page.clock.runFor(100);
  }
  await expect(locator).toHaveClass(/is-visible|is-active/);
}

for (const agent of ['Codex', 'Claude']) {
  test(`demo ${agent} playback, replay and clipboard failure`, async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.__intersections.some(item => item.target.matches('.pd-demo')))).toBe(true);
    await page.clock.install({ time: NOW });
    await page.clock.pauseAt(NOW);
    const demo = page.locator('.pd-demo');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo.getByRole('tab', { name: 'Codex', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => window.__intersections.find(item => item.target.matches('.pd-demo')).options.threshold)).toBe(0.35);
    // No playback occurs until visibility or a user action starts it.
    expect(await demo.locator('.pd-shell__progress-value').evaluate(el => el.style.width)).toBe('0%');
    await demo.getByRole('tab', { name: agent, exact: true }).click();
    await advanceUntil(page, demo.locator('.pd-recommendation'), locator => locator.evaluate(el => el.classList.contains('is-active')));
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('fixture denial'); }; });
    await demo.getByRole('button', { name: 'Copy recommendation', exact: true }).click();
    await expect(demo.locator('.pd-copy-button')).toContainText('Copied');
    await expect(demo.locator('.pd-copy-toast')).toContainText('Copied for your agent');
    await advanceUntil(page, demo.locator('.pd-finish'), locator => locator.evaluate(el => el.classList.contains('is-visible')));
    await demo.getByRole('button', { name: 'Replay demo' }).click();
    await expect(demo.locator('.pd-finish')).not.toHaveClass(/is-visible/);
    await expect(demo.locator('.pd-agent')).toHaveClass(/is-active/);
    await page.goto('/dashboard'); // unmount aborts outstanding playback
    await page.clock.runFor(10_000);
    await expect(page.getByLabel('Access token')).toBeVisible();
  });
}

test('demo viewport autoplay and switching agents cancel previous playback', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__intersections.some(item => item.target.matches('.pd-demo')))).toBe(true);
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW);
  await page.evaluate(() => {
    const observer = window.__intersections.find(item => item.target.matches('.pd-demo'));
    observer.callback([{ isIntersecting: true, target: observer.target }]);
  });
  await page.clock.runFor(300);
  const demo = page.locator('.pd-demo');
  await demo.getByRole('tab', { name: 'Claude', exact: true }).click();
  await expect(demo.getByRole('tab', { name: 'Claude', exact: true })).toHaveAttribute('aria-selected', 'true');
  await advanceUntil(page, demo.locator('.pd-finish'), locator => locator.evaluate(el => el.classList.contains('is-visible')));
  await expect(demo.locator('.pd-agent__name')).toContainText('Claude');
});
