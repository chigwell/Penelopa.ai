'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

// Characterize the existing main process without opening windows, using
// personal credentials, spawning commands, or making HTTP requests.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-main-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  const state = { prefs: { paused: false, notifications: false, autostart: false }, update: {}, install: null };
  const auth = {
    token: 'synthetic-account', state: () => ({ authenticated: !!auth.token }),
    signOut: reason => { calls.push(['sign-out', reason]); auth.token = null; },
    connect: async () => { calls.push(['connect']); auth.token = 'synthetic-account'; },
    initialise: async () => {},
  };
  function contents(local) {
    const value = new EventEmitter();
    value.mainFrame = { url: local ? 'penelopa://app/index.html' : 'https://penelopa.ai/dashboard', isDestroyed: () => false };
    value.session = new EventEmitter();
    value.session.setPermissionRequestHandler = handler => { value.permissionRequest = handler; };
    value.session.setPermissionCheckHandler = handler => { value.permissionCheck = handler; };
    value.setWindowOpenHandler = handler => { value.openHandler = handler; };
    value.send = (channel, data) => calls.push(['send', channel, data]);
    value.loadURL = async url => { calls.push(['load', url]); if (state.offline) throw Error('offline'); };
    return value;
  }
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = contents(true);
      this.contentView = { addChildView() {} }; state.window = this;
    }
    isDestroyed() { return false; }
    isVisible() { return true; }
    getContentSize() { return [1240, 840]; }
    show() { calls.push(['show']); }
    focus() { calls.push(['focus']); }
    hide() { calls.push(['hide']); }
    async loadURL(url) { calls.push(['local-load', url]); }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = contents(false); state.view = this; }
    setVisible(value) { calls.push(['visible', value]); }
    setBounds(value) { calls.push(['bounds', value]); }
  }
  const app = new EventEmitter();
  Object.assign(app, {
    setPath() {}, setName() {}, setAppUserModelId() {}, getVersion: () => '1.0.3',
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}),
    quit: () => calls.push(['quit']), exit: code => calls.push(['exit', code]),
  });
  const net = { fetch: async (url, options) => { calls.push(['fetch', url, options]); return state.response || { status: 200, text: async () => '{"ok":true}' }; } };
  const electron = {
    app, net, BrowserWindow: Window, WebContentsView: View,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: {},
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    Notification: class { static isSupported() { return false; } },
    shell: { openExternal: async url => { calls.push(['external', url]); } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }), showErrorBox() {} },
  };
  const filename = path.resolve(__dirname, '../main.cjs'), realRequire = createRequire(filename);
  const files = realRequire('./runtime/files.cjs');
  const mockedFiles = {
    ...files, home: () => root, installState: () => state.install, settings: () => state.prefs,
    readJson: (file, fallback) => file.endsWith('update.json') ? state.update : files.readJson(file, fallback),
    writeJson: (file, value) => {
      if (file.endsWith('preferences.json')) state.prefs = value;
      if (file.endsWith('update.json')) state.update = value;
      files.writeJson(file, value);
    },
  };
  const mocks = {
    electron, './runtime/files.cjs': mockedFiles,
    './runtime/status.cjs': { status: () => ({ agents: [] }), diagnostics: () => ({ agents: [] }) },
    './runtime/auth.cjs': { AuthSession: function () { return auth; } },
    './runtime/notifications.cjs': { RecommendationPoller: class { async poll() {} delay() { return 30_000; } } },
    './runtime/startup.cjs': { setAutostart: (enabled, install) => calls.push(['autostart', enabled, install]) },
    'node:child_process': { spawn: (executable, args, options) => {
      calls.push(['spawn', executable, args, options]);
      const child = new EventEmitter(); child.pid = 12345; child.unref = () => calls.push(['unref']); return child;
    } },
  };
  function mockedRequire(id) {
    if (mocks[id]) return mocks[id];
    if (id === path.join(root, 'release/runtime/hook.cjs')) return { wake: () => calls.push(['wake']) };
    if (id === path.join(root, 'release/runtime/update.cjs')) return { check: async () => calls.push(['check-update']) };
    return realRequire(id);
  }
  const context = vm.createContext({
    require: mockedRequire, __dirname: path.dirname(filename), module: { exports: {} },
    process: { ...process, platform: 'darwin', argv: ['node', filename], env: { ...process.env, AUTO_IMPROVE_HOME: root } },
    console, URL, Response, AbortSignal,
    setTimeout: () => 1, setInterval: () => 1, clearTimeout() {},
  });
  const expose = '\nmodule.exports = { initialise, apiRequest, localAction, showPage, configureContent, localState };';
  vm.runInContext(fs.readFileSync(filename, 'utf8') + expose, context, { filename });
  return { root, calls, state, auth, app, handlers, electron, main: context.module.exports };
}

test('main API transport retains validated requests, null responses, and account-expiry recovery', async t => {
  const f = fixture(t); await f.main.initialise(); f.calls.length = 0;
  let response = await f.main.apiRequest({ path: '/v1/admin/stats/summary' });
  assert.equal(response.status, 200); assert.equal(response.data.ok, true);
  const [, url, options] = f.calls.find(call => call[0] === 'fetch');
  assert.equal(url, 'https://api.penelopa.ai/v1/admin/stats/summary');
  assert.equal(options.headers.Authorization, 'Bearer synthetic-account');
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  f.state.response = { status: 204, text: async () => { throw Error('must not read'); } };
  response = await f.main.apiRequest({ path: '/v1/admin/stats/summary' }); assert.equal(response.data, null);
  f.state.response = { status: 403, text: async () => '{}' };
  await f.main.apiRequest({ path: '/v1/admin/stats/summary' });
  assert.equal(f.auth.token, null); assert.equal(f.main.localState().page, 'connection');
  f.calls.length = 0;
  assert.equal((await f.main.apiRequest({ path: '/v1/admin/stats/summary' })).status, 401);
  assert.equal(f.calls.filter(call => call[0] === 'fetch').length, 0);
  await assert.rejects(f.main.apiRequest({ path: '/v1/auth/bootstrap-token', method: 'POST' }));
});

test('local actions preserve preference effects, sign-out, reconnect, and update handoff', async t => {
  const f = fixture(t); await f.main.initialise();
  f.state.install = { nodePath: '/private/node', releaseDir: path.join(f.root, 'release') };
  fs.writeFileSync(path.join(f.root, 'notification-state.json'), '{}');
  await f.main.localAction('preferences', { autostart: true, notifications: true, paused: true });
  assert.equal(f.state.prefs.autostart, true); assert.equal(fs.existsSync(path.join(f.root, 'notification-state.json')), false);
  assert.equal(f.calls.filter(call => call[0] === 'autostart').length, 1);
  f.calls.length = 0;
  await f.main.localAction('preferences', { paused: false });
  assert.equal(f.calls.filter(call => call[0] === 'wake').length, 1);
  await assert.rejects(f.main.localAction('preferences', { paused: 'true' }));
  await f.main.localAction('sign-out'); assert.equal(f.main.localState().page, 'connection');
  await f.main.localAction('connect'); assert.equal(f.main.localState().page, 'dashboard');
  await f.main.localAction('update');
  const spawned = f.calls.find(call => call[0] === 'spawn');
  assert.equal(spawned[1], '/private/node'); assert.equal(spawned[2][1], '--prepare');
  assert.equal(spawned[3].detached, true); assert.equal(f.state.update.phase, 'downloading');
  await assert.rejects(f.main.localAction('update'), /already running/);
});

test('window close hides to tray, explicit Quit exits, and failed navigation shows offline state', async t => {
  const f = fixture(t); await f.main.initialise();
  f.calls.length = 0; let prevented = false;
  f.state.window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.ok(f.calls.some(call => call[0] === 'hide'));
  assert.equal(f.calls.some(call => call[0] === 'quit'), false);
  f.state.offline = true; f.main.showPage('dashboard'); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.main.localState().page, 'offline');
  await f.main.localAction('quit'); assert.ok(f.calls.some(call => call[0] === 'quit'));
  prevented = false; f.state.window.emit('close', { preventDefault: () => { prevented = true; } }); assert.equal(prevented, false);
});

test('main IPC and navigation retain local/remote trust boundaries', async t => {
  const f = fixture(t); await f.main.initialise();
  const web = f.state.view.webContents, local = f.state.window.webContents;
  assert.throws(() => f.handlers.get('web:auth')({ senderFrame: local.mainFrame }), /Untrusted/);
  assert.equal(f.handlers.get('web:auth')({ senderFrame: web.mainFrame }).authenticated, true);
  await assert.rejects(f.handlers.get('local:action')({ senderFrame: web.mainFrame }, 'quit'), /Untrusted/);
  assert.equal(web.permissionCheck(), false);
  let permission; web.permissionRequest(null, 'camera', value => { permission = value; }); assert.equal(permission, false);
  let prevented = false;
  web.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/');
  assert.equal(prevented, true); assert.ok(f.calls.some(call => call[0] === 'external' && call[1] === 'https://example.com/'));
  assert.equal(web.openHandler({ url: 'file:///private/file' }).action, 'deny');
  assert.equal(f.state.window.options.webPreferences.nodeIntegration, false);
  assert.equal(f.state.view.options.webPreferences.sandbox, true);
});
