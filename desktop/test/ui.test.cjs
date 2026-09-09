'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ui() {
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  const context = vm.createContext({
    window: {},
    document: { addEventListener() {} },
    module: { exports: {} },
    setTimeout() { return 1; },
  });
  vm.runInContext(`${source}\nmodule.exports = { pollingStatus, toastStatus, updateStatus, updateDetail, settingsPage, workspaceLoading };`, context);
  return context.module.exports;
}

function state(update, notificationHealth) {
  return {
    version: '1.0.6',
    preferences: { paused: false, notifications: true, autostart: true },
    connection: { desktop: { signed: 'ad-hoc' } },
    update,
    notificationHealth,
  };
}

test('App settings renders quiet notification diagnostics without recommendation content', () => {
  const app = ui();
  const html = app.settingsPage(state(
    { phase: 'idle', available: false, checkedAt: '2026-09-07T16:00:00Z' },
    {
      polling: { status: 'retrying', lastFailureAt: '2026-09-07T16:01:00Z', failures: 3 },
      toast: { status: 'unconfirmed', lastUnconfirmedAt: '2026-09-07T16:02:00Z', source: 'test' },
    },
  ));
  assert.match(html, /Could not check recommendations\. Retrying automatically/);
  assert.match(html, /notification settings/);
  assert.doesNotMatch(html, /recommendation title|private-token/i);
});

test('native workspace loading reserves content space and announces one loading status', () => {
  const html = ui().workspaceLoading();
  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.match(html, /skeleton-heading/);
  assert.match(html, /skeleton-panel/);
  assert.match(fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8'), /data-page="sessions"/);
});

test('App settings exposes an available update and suppresses restart while checking', () => {
  const app = ui();
  const available = app.settingsPage(state(
    { phase: 'idle', available: true, version: '1.0.7' },
    { polling: { status: 'healthy', lastSuccessAt: '2026-09-07T16:00:00Z' }, toast: { status: 'shown', lastShownAt: '2026-09-07T16:00:00Z' } },
  ));
  assert.match(available, /Update 1\.0\.7/);
  assert.match(available, /data-action="update"/);

  const checking = app.settingsPage(state(
    { phase: 'checking' },
    { polling: { status: 'checking' }, toast: {} },
  ));
  assert.match(checking, /Checking the current Penelopa release/);
  assert.doesNotMatch(checking, /data-action="update"/);
});
