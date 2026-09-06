'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, safeStorage, Tray, Menu, nativeImage, Notification, shell, dialog } = require('electron');
try {
  const binding = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'penelopa-install.json'), 'utf8'));
  if (!process.env.AUTO_IMPROVE_HOME) process.env.AUTO_IMPROVE_HOME = binding.root;
} catch {}
const { home, mkdir, readJson, writeJson, installState, settings } = require('./runtime/files.cjs');
const { validateRequest, trustedFrame, externalUrl, WEB_ORIGIN } = require('./runtime/api.cjs');
const { AuthSession } = require('./runtime/auth.cjs');
const { status, diagnostics } = require('./runtime/status.cjs');
const { RecommendationPoller } = require('./runtime/notifications.cjs');
const root = home(); mkdir(root);
const smokeIndex = process.argv.indexOf('--penelopa-smoke-test');
app.setPath('userData', path.join(root, smokeIndex >= 0 ? 'launch-check-profile' : 'browser-profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'penelopa', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Penelopa.ai'); app.setAppUserModelId('ai.penelopa.desktop');
let window, view, tray, auth, poller, activePage = 'dashboard', quitting = false, nativeError = null;
const timers = [];

function registerShortcut() {
  if (process.platform !== 'win32') return;
  const shortcut = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Penelopa.ai.lnk');
  mkdir(path.dirname(shortcut));
  if (!shell.writeShortcutLink(shortcut, { target: process.execPath, cwd: path.dirname(process.execPath), description: 'Penelopa.ai', appUserModelId: 'ai.penelopa.desktop', toastActivatorClsid: 'CD72630E-40D9-4FBD-8D14-2B1E2BC9D9E6', icon: process.execPath, iconIndex: 0 })) throw new Error('The Windows Start Menu shortcut could not be created.');
  if (shell.readShortcutLink(shortcut).appUserModelId !== 'ai.penelopa.desktop') throw new Error('The Windows shortcut identity could not be verified.');
}

function webAllowed(value) { try { const url = new URL(value); return url.origin === WEB_ORIGIN && /^\/dashboard(?:\/|$)/.test(url.pathname); } catch { return false; } }
function showWindow() { if (window) { window.show(); window.focus(); } }
function viewBounds() { if (!window || !view) return; const [width, height] = window.getContentSize(); view.setBounds({ x: 216, y: 64, width: Math.max(0, width - 216), height: Math.max(0, height - 64) }); }
function hideRemote() { if (view) view.setVisible(false); }
function showPage(page, recommendationId) {
  activePage = page;
  if (['connection', 'settings'].includes(page)) { hideRemote(); pushState(); return; }
  const route = page === 'notifications' ? '/dashboard/notifications' : recommendationId ? `/dashboard/recommendations/${encodeURIComponent(recommendationId)}` : '/dashboard';
  activePage = page === 'notifications' ? 'notifications' : 'dashboard';
  view.setVisible(true); viewBounds();
  view.webContents.loadURL(`${WEB_ORIGIN}${route}`).catch(() => { hideRemote(); activePage = 'offline'; pushState(); });
  pushState();
}
function localState() {
  let connection;
  try { connection = status(root); } catch { connection = { installed: false, agents: [], errors: [{ error: 'Local configuration could not be read. Run Repair hooks.' }] }; }
  return { page: activePage, connection, auth: auth?.state(), preferences: settings(root),
    update: readJson(path.join(root, 'update.json'), {}), nativeError, version: app.getVersion() };
}
function pushState() { if (window && !window.isDestroyed()) window.webContents.send('local:state', localState()); }
function trustedWeb(event) { if (!view || !trustedFrame(event.senderFrame, view.webContents)) throw new Error('Untrusted IPC sender.'); }
function trustedLocal(event) { if (!window || !trustedFrame(event.senderFrame, window.webContents, true)) throw new Error('Untrusted IPC sender.'); }
async function apiRequest(request) {
  const validated = validateRequest(request);
  if (!auth.token) return { status: 401, data: { detail: 'Reconnect your installed account from Connection.' } };
  const accountToken = auth.token;
  try {
    const response = await net.fetch(validated.url, { method: validated.method, redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accountToken}`, ...(validated.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(validated.body === undefined ? {} : { body: JSON.stringify(validated.body) }), signal: AbortSignal.timeout(20_000) });
    let data = null;
    if (response.status !== 204) { const text = await response.text(); if (text.length > 8_388_608) throw new Error('Response too large.'); try { data = JSON.parse(text); } catch {} }
    if ([401, 403].includes(response.status) && auth.token === accountToken) { auth.signOut('Your installed account needs to be reconnected.'); showPage('connection'); }
    return { status: response.status, data };
  } catch { return { status: 503, data: { detail: 'Penelopa is currently unreachable. Your local queue is safe. Try again when you are online.' } }; }
}
async function managedCommand(args) {
  const state = installState(root);
  if (!state) throw new Error('Run the Penelopa installer first.');
  return new Promise((resolve, reject) => {
    const child = spawn(state.nodePath, [path.join(state.releaseDir, 'runtime', 'install.cjs'), ...args], { windowsHide: true, stdio: 'ignore', env: { ...process.env, AUTO_IMPROVE_HOME: root } });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Repair did not complete. Run the installer again to see the failing step.')));
  });
}
function wakeWorker() {
  const state = installState(root);
  if (!state || settings(root).paused) return;
  // Execute the installed runtime outside the renderer and the application
  // bundle so hooks continue working when the desktop window is closed.
  try { require(path.join(state.releaseDir, 'runtime', 'hook.cjs')).wake(root); } catch { nativeError = 'Background delivery could not start. Use Repair hooks.'; }
}
function startUpdater(mode, purge = false) {
  const state = installState(root);
  if (!state) throw new Error('No installation was found.');
  if (['downloading', 'building', 'ready-to-restart'].includes(readJson(path.join(root, 'update.json'), {}).phase)) throw new Error('An update is already running.');
  if (mode === '--prepare') writeJson(path.join(root, 'update.json'), { phase: 'downloading' });
  const child = spawn(state.nodePath, [path.join(state.releaseDir, 'runtime', 'update.cjs'), mode, String(process.pid), ...(purge ? ['--purge-data'] : [])],
    { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, AUTO_IMPROVE_HOME: root } });
  if (mode === '--prepare') writeJson(path.join(root, 'update.json'), { phase: 'downloading', pid: child.pid });
  child.on('error', () => { writeJson(path.join(root, 'update.json'), { phase: 'error', error: 'The updater could not start. Retry the update.' }); nativeError = 'The updater could not start.'; pushState(); }); child.unref();
  if (mode === '--uninstall') { quitting = true; app.quit(); }
}
function notify(items) {
  if (!Notification.isSupported()) { nativeError = 'System notifications are unavailable. Recommendations remain available in the dashboard.'; pushState(); return; }
  const one = items.length === 1;
  const notification = new Notification({ title: one ? 'New Penelopa recommendation' : `${items.length} new recommendations`,
    body: one ? String(items[0].title || 'Your recommendation is ready.').slice(0, 150) : 'Open Penelopa.ai to review your latest recommendations.', silent: false });
  notification.on('click', () => { showWindow(); showPage('dashboard', one ? items[0].id : undefined); });
  notification.on('failed', () => { nativeError = 'Notifications could not be displayed. Check the operating system notification settings for Penelopa.ai.'; pushState(); });
  notification.show();
}
async function pollRecommendations() {
  if (quitting) return;
  if (settings(root).notifications) await poller.poll();
  timers.push(setTimeout(pollRecommendations, poller.delay()));
}
async function checkUpdate() {
  const state = installState(root);
  if (!state) return;
  const current = readJson(path.join(root, 'update.json'), {});
  if (['downloading', 'building', 'ready-to-restart'].includes(current.phase)) return;
  try { await require(path.join(state.releaseDir, 'runtime', 'update.cjs')).check(root); }
  catch { nativeError = 'Update check is unavailable. Your installed version is unchanged.'; }
  pushState();
}
async function localAction(action, data) {
  switch (action) {
    case 'state': return localState();
    case 'navigate': if (!['dashboard', 'notifications', 'connection', 'settings'].includes(data)) throw new Error('Unknown page.'); showPage(data); break;
    case 'retry': wakeWorker(); break;
    case 'repair': await managedCommand(['--repair']); nativeError = null; break;
    case 'connect': await auth.connect(); if (auth.token) showPage('dashboard'); break;
    case 'sign-out': auth.signOut(); showPage('connection'); break;
    case 'preferences': {
      if (!data || Array.isArray(data) || Object.entries(data).some(([key, value]) => !['paused', 'notifications', 'autostart'].includes(key) || typeof value !== 'boolean')) throw new Error('Invalid app settings.');
      const old = settings(root); const next = { ...old, ...data };
      if (next.autostart !== old.autostart) require('./runtime/startup.cjs').setAutostart(next.autostart, installState(root));
      if (next.notifications !== old.notifications) fs.rmSync(path.join(root, 'notification-state.json'), { force: true });
      writeJson(path.join(root, 'preferences.json'), next); if (!next.paused) wakeWorker(); break;
    }
    case 'test-notification': notify([{ id: '', title: 'Notifications are enabled for this computer.' }]); break;
    case 'export-diagnostics': {
      const result = await dialog.showSaveDialog(window, { title: 'Export connection diagnostics', defaultPath: 'penelopa-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) writeJson(result.filePath, diagnostics(root)); break;
    }
    case 'check-update': await checkUpdate(); break;
    case 'update': startUpdater('--prepare'); break;
    case 'uninstall': {
      const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Uninstall'], defaultId: 0, cancelId: 0,
        message: 'Uninstall Penelopa.ai?', detail: 'Only Penelopa hooks, the app and its startup entry will be removed. Other agent settings stay in place.', checkboxLabel: 'Also delete my local credentials and queued data', checkboxChecked: false });
      if (result.response === 1) startUpdater('--uninstall', result.checkboxChecked); break;
    }
    case 'quit': quitting = true; app.quit(); break;
    default: throw new Error('Unknown desktop action.');
  }
  pushState(); return localState();
}
function configureContent(contents, remote) {
  contents.setWindowOpenHandler(({ url }) => { if (externalUrl(url)) void shell.openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (remote ? !webAllowed(url) : !url.startsWith('penelopa://app/')) { event.preventDefault(); if (externalUrl(url)) void shell.openExternal(url); } });
  contents.on('will-redirect', (event, url) => { if (remote && !webAllowed(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on('will-download', event => event.preventDefault());
}
async function initialise() {
  if (process.argv.includes('--penelopa-register-shortcut')) { registerShortcut(); app.quit(); return; }
  protocol.handle('penelopa', request => {
    const url = new URL(request.url); const files = new Set(['index.html', 'app.css', 'app.js']);
    const name = url.pathname.slice(1) || 'index.html';
    if (url.hostname !== 'app' || !files.has(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'ui', name)).href);
  });
  if (smokeIndex >= 0) {
    const marker = process.argv[smokeIndex + 1];
    const testWindow = new BrowserWindow({ width: 1240, height: 840, show: false, webPreferences: { preload: path.join(__dirname, 'local-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    ipcMain.handle('local:action', event => {
      if (!trustedFrame(event.senderFrame, testWindow.webContents, true)) throw new Error('Untrusted test frame.');
      return { page: 'connection', connection: { agents: [{ name: 'Codex', configured: true, state: 'awaiting-event' }, { name: 'Claude Code', configured: true, state: 'awaiting-event' }], pendingEvents: 0, queuedSegments: 0, selfTest: { passed: true } }, auth: { authenticated: false }, preferences: { paused: false }, version: app.getVersion() };
    });
    await testWindow.loadURL('penelopa://app/index.html');
    const checks = await testWindow.webContents.executeJavaScript(`(async()=>{await window.penelopa.invoke('state');for(let i=0;i<40&&!document.querySelector('h1');i++)await new Promise(r=>setTimeout(r,50));return {bridge:!!window.penelopa,isolated:typeof require==='undefined'&&typeof process==='undefined',heading:document.querySelector('h1')?.textContent}})()`);
    if (!checks.bridge || !checks.isolated || checks.heading !== 'A clear connection.') throw new Error('Desktop renderer verification failed.');
    await testWindow.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(`${marker}.png`, (await testWindow.webContents.capturePage()).toPNG());
    writeJson(marker, { ready: true, version: app.getVersion(), ...checks }); app.quit(); return;
  }
  auth = new AuthSession(safeStorage, root); await auth.initialise();
  writeJson(path.join(root, 'desktop-running.json'), { pid: process.pid });
  fs.rmSync(path.join(root, 'quit-request.json'), { force: true });
  window = new BrowserWindow({ width: 1240, height: 840, minWidth: 900, minHeight: 600, title: 'Penelopa.ai', backgroundColor: '#f5f5f2', show: false,
    webPreferences: { preload: path.join(__dirname, 'local-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:penelopa-dashboard', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.contentView.addChildView(view); configureContent(window.webContents, false); configureContent(view.webContents, true);
  view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) { hideRemote(); activePage = 'offline'; pushState(); } });
  view.webContents.on('render-process-gone', () => { hideRemote(); activePage = 'offline'; pushState(); });
  window.on('resize', viewBounds);
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  ipcMain.handle('web:auth', event => { trustedWeb(event); return auth.state(); });
  ipcMain.handle('web:sign-out', event => { trustedWeb(event); if (auth.token) auth.signOut(); showPage('connection'); });
  ipcMain.handle('web:connection', event => { trustedWeb(event); showPage('connection'); });
  ipcMain.handle('web:request', (event, request) => { trustedWeb(event); return apiRequest(request); });
  ipcMain.handle('local:action', async (event, action, data) => { trustedLocal(event); try { return await localAction(action, data); } catch (error) { nativeError = error.message; pushState(); throw new Error(error.message); } });
  await window.loadURL('penelopa://app/index.html');
  showPage(auth.token ? 'dashboard' : 'connection'); viewBounds();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'app.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon); tray.setToolTip('Penelopa.ai');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Penelopa.ai', click: showWindow }, { label: 'Connection', click: () => { showWindow(); showPage('connection'); } }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
  tray.on('click', showWindow);
  registerShortcut();
  if (!process.argv.includes('--background')) showWindow();
  poller = new RecommendationPoller(apiRequest, () => settings(root).notifications ? auth.token : null, notify, root); void pollRecommendations();
  wakeWorker(); timers.push(setInterval(wakeWorker, 30_000));
  timers.push(setInterval(() => {
    const update = readJson(path.join(root, 'update.json'), {});
    const updating = ['downloading', 'building', 'ready-to-restart'].includes(update.phase);
    if (updating && update.pid && !require('./runtime/lifecycle.cjs').alive(update.pid)) {
      writeJson(path.join(root, 'update.json'), { phase: 'error', available: true, error: 'The updater stopped before finishing. Your existing version is preserved. Retry the update.' });
    } else if (update.phase === 'ready-to-restart' || fs.existsSync(path.join(root, 'quit-request.json'))) { quitting = true; app.quit(); }
    if (window.isVisible()) pushState();
  }, 2000));
  void checkUpdate(); timers.push(setInterval(checkUpdate, 24 * 60 * 60_000));
}
if (smokeIndex < 0 && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { showWindow(); pushState(); });
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true; for (const timer of timers) clearTimeout(timer);
    if (readJson(path.join(root, 'desktop-running.json'), null)?.pid === process.pid) fs.rmSync(path.join(root, 'desktop-running.json'), { force: true });
  });
  app.whenReady().then(initialise).catch(() => { dialog.showErrorBox('Penelopa.ai could not start', 'Your hooks and queued data are preserved. Run the installer again or use --diagnose.'); app.exit(1); });
}
