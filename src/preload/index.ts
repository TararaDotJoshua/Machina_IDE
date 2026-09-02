import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, MachinaBridge, UpdateState } from '@mechatronics-ide/core';

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
    createFolder: (parentId) => ipcRenderer.invoke('machina:project:createFolder', parentId),
    moveItem: (itemId, parentId, order) => ipcRenderer.invoke('machina:project:moveItem', itemId, parentId, order),
    reorderItems: (parentId, itemIds) => ipcRenderer.invoke('machina:project:reorderItems', parentId, itemIds),
    readAsset: (relativePath) => ipcRenderer.invoke('machina:project:readAsset', relativePath),
  },
  plugins: {
    setEnabled: (pluginId, enabled) => ipcRenderer.invoke('machina:plugins:setEnabled', pluginId, enabled),
    reload: () => ipcRenderer.invoke('machina:plugins:reload'),
    activateEvent: (event) => ipcRenderer.invoke('machina:plugins:activateEvent', event),
    getLibrary: (refresh) => ipcRenderer.invoke('machina:plugins:getLibrary', refresh),
    install: (pluginId) => ipcRenderer.invoke('machina:plugins:install', pluginId),
    uninstall: (pluginId) => ipcRenderer.invoke('machina:plugins:uninstall', pluginId),
  },
  commands: { execute: (commandId, args) => ipcRenderer.invoke('machina:commands:execute', commandId, args) },
  workers: { cancel: (instanceId) => ipcRenderer.invoke('machina:workers:cancel', instanceId) },
  ai: { invoke: (pluginId, toolName, input) => ipcRenderer.invoke('machina:ai:invoke', pluginId, toolName, input) },
  updates: {
    getState: () => ipcRenderer.invoke('machina:updates:getState'),
    check: () => ipcRenderer.invoke('machina:updates:check'),
    install: () => ipcRenderer.invoke('machina:updates:install'),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on('machina:updateState', handler);
      return () => ipcRenderer.removeListener('machina:updateState', handler);
    },
  },
};

contextBridge.exposeInMainWorld('machina', bridge);
