'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('penelopa', Object.freeze({
  invoke: (action, data) => ipcRenderer.invoke('local:action', action, data),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('local:state', listener); return () => ipcRenderer.removeListener('local:state', listener); },
}));
