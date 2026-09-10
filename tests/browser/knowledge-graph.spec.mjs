import { test, expect } from '@playwright/test';
import { setup } from './fixtures.mjs';
import { setupGraphs, graphRuns, projectId, graphResponse, communityResponse } from './graph-fixtures.mjs';
import { canvasState, expectReadyCanvas, chooseCanvasEntity, timelineColors } from './graph-canvas-helpers.mjs';

test('empty accounts hide all graph navigation and direct entry returns to Dashboard', async ({ page }) => {
  await setup(page, { token: 'fixture-token' });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toHaveCount(0);
  await expect(page.locator('.kg-canvas')).toHaveCount(0);
});
test('latest, all-time, provenance, filters and URL navigation', async ({ page }) => {
  const { requests } = await setupGraphs(page);
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await expect(page.getByRole('heading', { name: 'Entities & connections' })).toBeVisible();
  await page.getByRole('button', { name: 'API 1 connections' }).click();
  await expect(page.getByLabel('Knowledge detail')).toBeVisible();
  await expect(page.getByLabel('Knowledge detail').getByText('stores', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'View all time' }).click();
  await expect(page.locator('.kg-count')).toHaveText('4 entities · 3 connections');
  await expect(page).toHaveURL(/mode=all/);
  await page.goBack();
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await page.getByRole('button', { name: 'View all time' }).click();
  await page.getByLabel('Relationship', { exact: true }).selectOption('uses');
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await page.getByLabel('Relationship', { exact: true }).selectOption('');
  await page.getByLabel('Source', { exact: true }).selectOption('codex-openai');
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await expect(page.getByRole('button', { name: 'Dashboard 2 connections' })).toHaveCount(0);
  await page.getByLabel('Search entities').fill('Knowledge');
  await expect(page.getByLabel('Matching entities')).toContainText('1 matches');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toContain(`project=${projectId}`);
  expect(requests.filter(request => request.path.startsWith('/v2/user-read/knowledge-graphs?')).every(request => request.path.includes('current_only=false'))).toBe(true);
});
test('historical-only availability traverses empty cursor pages', async ({ page }) => {
  await setupGraphs(page, { respond: entry => {
    const url = new URL(entry.path, 'https://fixture');
    if (url.pathname !== '/v2/user-read/knowledge-graphs') return;
    return { json: { items: url.searchParams.has('cursor') ? [graphRuns[0]] : [], next_cursor: url.searchParams.has('cursor') ? null : 'page-two', truncated: !url.searchParams.has('cursor') } };
  } });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toBeVisible();
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
});
test('transient failures remain distinguishable from empty graphs and retry succeeds', async ({ page }) => {
  let failing = true;
  await setupGraphs(page, { respond: entry => entry.path.startsWith('/v2/user-read/knowledge-graphs?') && failing ? { status: 503, json: { detail: 'Temporary outage' } } : undefined });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.getByRole('heading', { name: 'Knowledge could not be loaded.' })).toBeVisible();
  await expect(page).toHaveURL(/knowledge-graph/);
  await expect(page.locator('.kg-canvas')).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
});
test('older desktop bridge cannot request graphs or use browser credentials', async ({ page }) => {
  const { requests } = await setupGraphs(page);
  await page.addInitScript(() => { window.penelopaDesktop = { version: 1, capabilities: { transcriptRead: true }, auth: { state: async () => ({ authenticated: true }), signOut: async () => {} }, request: async () => { throw new Error('Graph IPC must not run'); } }; });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.getByText('Update & restart in App settings to explore knowledge graphs.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toHaveCount(0);
  expect(requests.filter(request => request.path.includes('knowledge-graph'))).toHaveLength(0);
});
test('logout discards late graph responses and hides navigation', async ({ page }) => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  await setupGraphs(page, { respond: async entry => {
    if (entry.path.startsWith(`/v2/user-read/knowledge-graphs/${graphRuns[0].id}`)) { await pending; return graphResponse(entry); }
  } });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click(); resolve();
  await expect(page.getByLabel('Access token')).toBeVisible();
  await expect(page.locator('.kg-stage')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true })).toHaveCount(0);
});
test('real Cosmograph uses local WASM and renders in both themes', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await setupGraphs(page, { fallback: false });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('.kg-canvas canvas').first()).toBeVisible();
  await expect(page.locator('.kg-native-timeline')).toBeVisible();
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await expect(async () => {
    const stage = await page.locator('.kg-stage').boundingBox();
    const labels = await page.locator('.kg-point-label').evaluateAll(elements => elements.filter(element => getComputedStyle(element).opacity === '1').map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; }));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) { expect(label.top).toBeGreaterThanOrEqual(stage.y); expect(label.bottom).toBeLessThanOrEqual(stage.y + stage.height); expect(label.left).toBeGreaterThanOrEqual(stage.x); expect(label.right).toBeLessThanOrEqual(stage.x + stage.width); }
  }).toPass();
  await page.screenshot({ path: testInfo.outputPath('graph-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: testInfo.outputPath('graph-dark.png'), fullPage: true });
  await page.locator('.kg-native-timeline').scrollIntoViewIfNeeded();
  const timeline = await page.locator('.kg-native-timeline').boundingBox();
  await page.mouse.move(timeline.x + timeline.width * 0.2, timeline.y + timeline.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(timeline.x + timeline.width * 0.75, timeline.y + timeline.height * 0.65);
  await page.mouse.up();
  await expect(page).toHaveURL(/mode=range/);
  await expect(page).toHaveURL(/from=.*to=/);
  await page.getByRole('button', { name: 'View all time' }).click();
  await expect(page.locator('.kg-count')).toHaveText('4 entities · 3 connections');
  await page.getByRole('button', { name: 'Latest', exact: true }).click();
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await expectReadyCanvas(page);
  expect(failures).toEqual([]);
});

test('session entry appears only when its own graph is available', async ({ page }) => {
  const { session } = await import('./transcript-fixtures.mjs');
  await setupGraphs(page);
  await page.goto(`/dashboard/sessions/${session.id}`);
  const link = page.locator('.session-workspace-toolbar').getByRole('link', { name: 'Knowledge Graph' });
  await expect(link).toBeVisible(); await link.click();
  await expect(page).toHaveURL(new RegExp(`session=${session.id}`));
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
});

test('desktop graph IPC uses only bounded paths and never sends renderer credentials', async ({ page }) => {
  await setupGraphs(page);
  await page.exposeFunction('fixtureGraphRequest', request => {
    expect(Object.keys(request).sort()).toEqual(['method', 'path']);
    const response = graphResponse({ path: request.path });
    return { status: response.status || 200, data: response.json };
  });
  await page.addInitScript(() => { window.penelopaDesktop = { version: 1, capabilities: { transcriptRead: true, knowledgeGraphRead: true }, auth: { state: async () => ({ authenticated: true }), signOut: async () => {} }, request: request => window.fixtureGraphRequest(request) }; });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.locator('.kg-count')).toHaveText('2 entities · 1 connections');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('.kg-stage')).toHaveCount(0);
});

test('real canvas handles an isolated node and a larger disconnected graph', async ({ page }) => {
  test.setTimeout(90_000);
  let size = 1;
  await setupGraphs(page, { fallback: false, respond: entry => {
    const path = new URL(entry.path, 'https://fixture').pathname;
    if (path === '/v2/user-read/knowledge-graphs') return { json: { items: [{ ...graphRuns[0], node_count: size }], next_cursor: null } };
    if (path === `/v2/user-read/knowledge-graphs/${graphRuns[0].id}`) {
      const url = new URL(entry.path, 'https://fixture'), offset = Number(url.searchParams.get('node_cursor') || 0), end = Math.min(size, offset + 500);
      return { json: { ...graphRuns[0], nodes: Array.from({ length: end - offset }, (_, i) => ({ id: `n${offset + i}`, label: `Entity ${offset + i}` })), edges: [], node_total: size, edge_total: 0, node_next_cursor: end < size ? String(end) : null, edge_next_cursor: null, nodes_truncated: end < size, edges_truncated: false } };
    }
  } });
  await page.goto('/dashboard/knowledge-graph');
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('.kg-count')).toHaveText('1 entities · 0 connections');
  size = 1200;
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('.kg-count')).toHaveText('1,200 entities · 0 connections');
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.getByLabel('Search entities').fill('Entity 1199');
  await page.getByLabel('Matching entities').getByRole('button', { name: 'Entity 1199', exact: true }).click();
  await expect(page.getByLabel('Knowledge detail')).toBeVisible();
});

test('communities, node size, exact incident highlights and neighborhood camera use the real renderer', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupGraphs(page, { fallback: false, respond: communityResponse });
  await page.goto('/dashboard/knowledge-graph?mode=all');
  await expectReadyCanvas(page);
  const initial = await canvasState(page);
  const hub = initial.points.find(p => p.label === 'Platform'), leaf = initial.points.find(p => p.label === 'Satellite');
  expect(hub.degree).toBe(8); expect(hub.size).toBeGreaterThan(leaf.size);
  expect(Math.min(...initial.points.map(p => p.size))).toBeGreaterThanOrEqual(7);
  expect(Math.max(...initial.points.map(p => p.size))).toBeLessThanOrEqual(20);
  expect(new Set(initial.points.map(p => p.community)).size).toBeGreaterThanOrEqual(4);
  expect(await timelineColors(page)).toEqual({ background: 'rgb(255, 254, 250)', text: '#4e4942', selection: '#2459c4' });
  // A label click uses the same path as a point click and must preserve all incident directions.
  await page.locator('.kg-point-label').filter({ hasText: /^Platform$/ }).first().click();
  await expect(page.getByLabel('Knowledge detail')).toBeVisible();
  await expect(async () => {
    const state = await canvasState(page);
    const incident = state.links.filter(l => l.source === hub.index || l.target === hub.index);
    expect(state.selectedLinks?.slice().sort((a, b) => a - b)).toEqual(incident.map(l => l.index).sort((a, b) => a - b));
    const neighbors = [...new Set([hub.index, ...incident.flatMap(l => [l.source, l.target])])];
    expect(state.selectedPoints?.slice().sort((a, b) => a - b)).toEqual(neighbors.sort((a, b) => a - b));
    expect(state.focused).toBe(hub.index);
    const box = await page.locator('.kg-canvas-main').boundingBox();
    for (const point of state.points.filter(p => neighbors.includes(p.index))) {
      expect(point.screen[0]).toBeGreaterThanOrEqual(0); expect(point.screen[0]).toBeLessThanOrEqual(box.width);
      expect(point.screen[1]).toBeGreaterThanOrEqual(0); expect(point.screen[1]).toBeLessThanOrEqual(box.height);
    }
  }).toPass();
  const selectedState = await canvasState(page);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(async () => (await canvasState(page)).points.find(p => p.label === 'Platform').color).not.toEqual(hub.color);
  expect((await canvasState(page)).camera).toEqual(selectedState.camera);
  expect(await timelineColors(page)).toEqual({ background: 'rgb(36, 33, 29)', text: '#ded7cb', selection: '#70acff' });
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await canvasState(page)).camera.zoom).toEqual(selectedState.camera.zoom);
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect.poll(async () => (await canvasState(page)).selectedLinks).toBeNull();
  const cleared = await canvasState(page);
  expect(cleared.selectedPoints).toBeNull(); expect(cleared.focused).toBeUndefined();
  // The viewport changes when the inspector closes, but the user camera must not be fitted again.
  expect(cleared.camera.zoom).toEqual(selectedState.camera.zoom);
  await page.goBack();
  await expect(page.getByLabel('Knowledge detail')).toBeVisible();
  await expect.poll(async () => (await canvasState(page)).selectedLinks?.length).toBe(8);
  await page.goForward();
  await expect(page.getByLabel('Knowledge detail')).toHaveCount(0);
  const beforeClick = await canvasState(page), research = beforeClick.points.find(p => p.label === 'Research');
  const canvas = await page.locator('.kg-canvas-main').boundingBox();
  await page.mouse.click(canvas.x + research.screen[0], canvas.y + research.screen[1]);
  await expect.poll(async () => (await canvasState(page)).focused).toBe(research.index);
  await expect.poll(async () => (await canvasState(page)).selectedLinks?.length).toBe(5);
  await page.getByRole('button', { name: 'Close details' }).click();
  await chooseCanvasEntity(page, 'Unconnected');
  await expect.poll(async () => (await canvasState(page)).selectedPoints?.length).toBe(1);
  expect((await canvasState(page)).selectedLinks || []).toEqual([]);
});

test('late community worker replies cannot restore a stale filtered graph; search does not recluster', async ({ page }) => {
  test.setTimeout(90_000);
  await setupGraphs(page, { fallback: false, respond: communityResponse });
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__presentationReplies = 0;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes('presentation.worker')) return;
        let listener;
        Object.defineProperty(this, 'onmessage', { get: () => listener, set: value => { listener = value; } });
        this.addEventListener('message', event => {
          window.__presentationReplies++;
          if (window.__presentationReplies === 1) window.__deliverOldPresentation = () => listener?.(event);
          else listener?.(event);
        });
      }
    };
  });
  await page.goto('/dashboard/knowledge-graph?mode=all');
  await expect.poll(() => page.evaluate(() => window.__presentationReplies), { timeout: 60_000 }).toBe(1);
  await page.getByLabel('Relationship', { exact: true }).selectOption('guides');
  await expectReadyCanvas(page);
  expect((await canvasState(page)).points.map(p => p.label).sort()).toEqual(['Design', 'Platform']);
  await page.evaluate(() => window.__deliverOldPresentation());
  await page.getByLabel('Search entities').fill('Design');
  await expect(page.getByLabel('Matching entities')).toContainText('1 matches');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  expect(await page.evaluate(() => window.__presentationReplies)).toBe(2);
  expect((await canvasState(page)).points.map(p => p.label).sort()).toEqual(['Design', 'Platform']);
});
