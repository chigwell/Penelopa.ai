// Synthetic native test harness: the production preload and allowlist execute in
// Electron; no account token or real API request is used by this fixture.
const { app, BrowserWindow, ipcMain } = require('electron');
const { validateRequest } = require('../../desktop/runtime/api.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-graph-electron-'));
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
  const { graphResponse } = await import('./graph-fixtures.mjs');
  ipcMain.handle('web:auth', () => ({ authenticated: true, signedOut: false }));
  ipcMain.handle('web:sign-out', () => undefined);
  ipcMain.handle('web:request', (_event, request) => {
    validateRequest(request);
    const response = graphResponse({ path: request.path });
    return { status: response.status || 200, data: response.json };
  });
  const window = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: {
    preload: path.resolve(__dirname, '../../desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  await window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
