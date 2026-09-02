import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, MachinaBridge } from '@mechatronics-ide/core';

const bridge: MachinaBridge = {
  app: {
    getSnapshot: () => ipcRenderer.invoke('machina:getSnapshot'),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
      ipcRenderer.on('machina:snapshot', handler);
      return () => ipcRenderer.removeListener('machina:snapshot', handler);
    },
    subscribeMenu: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => listener(action);
      ipcRenderer.on('machina:menu', handler);
      return () => ipcRenderer.removeListener('machina:menu', handler);
    },
  },
  project: {
    create: () => ipcRenderer.invoke('machina:project:create'),
    open: () => ipcRenderer.invoke('machina:project:open'),
    save: () => ipcRenderer.invoke('machina:project:save'),
    updateItem: (itemId, patch) => ipcRenderer.invoke('machina:project:updateItem', itemId, patch),
  },
  plugins: {
    setEnabled: (pluginId, enabled) => ipcRenderer.invoke('machina:plugins:setEnabled', pluginId, enabled),
    reload: () => ipcRenderer.invoke('machina:plugins:reload'),
    activateEvent: (event) => ipcRenderer.invoke('machina:plugins:activateEvent', event),
  },
  commands: { execute: (commandId, args) => ipcRenderer.invoke('machina:commands:execute', commandId, args) },
  workers: { cancel: (instanceId) => ipcRenderer.invoke('machina:workers:cancel', instanceId) },
  ai: { invoke: (pluginId, toolName, input) => ipcRenderer.invoke('machina:ai:invoke', pluginId, toolName, input) },
};

contextBridge.exposeInMainWorld('machina', bridge);
