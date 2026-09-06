'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('penelopaDesktop', Object.freeze({
  version: 1,
  auth: Object.freeze({ state: () => ipcRenderer.invoke('web:auth'), signOut: () => ipcRenderer.invoke('web:sign-out') }),
  request: request => ipcRenderer.invoke('web:request', request),
  openConnection: () => ipcRenderer.invoke('web:connection'),
}));
