'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('penelopaDesktop', Object.freeze({
  version: 1,
  capabilities: Object.freeze({ transcriptRead: true, knowledgeGraphRead: true }),
  auth: Object.freeze({ state: () => ipcRenderer.invoke('web:auth'), signOut: () => ipcRenderer.invoke('web:sign-out') }),
  request: request => ipcRenderer.invoke('web:request', request),
  openConnection: () => ipcRenderer.invoke('web:connection'),
}));
