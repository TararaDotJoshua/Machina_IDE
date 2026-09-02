import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { basename, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { autoUpdater } from 'electron-updater';
import type { AppSnapshot, OutputEntry } from '@mechatronics-ide/core';
import { ProjectService } from './project-service';
import { SettingsStore } from './settings-store';
import { WorkerManager } from './worker-manager';
import { PluginManager } from './plugin-manager';
import { PluginMarketplace } from './plugin-marketplace';
import { UpdateService } from './update-service';

let mainWindow: BrowserWindow | null = null;
const output: OutputEntry[] = [];
const projects = new ProjectService();
let settings: SettingsStore;
let plugins: PluginManager;
let marketplace: PluginMarketplace;
let workers: WorkerManager;
let updates: UpdateService;
let updateInterval: NodeJS.Timeout | undefined;

function appendOutput(source: string, level: OutputEntry['level'], message: string): void {
  for (const line of message.split(/\r?\n/).filter(Boolean)) {
    output.push({ id: randomUUID(), timestamp: new Date().toISOString(), source, level, message: line });
  }
  if (output.length > 500) output.splice(0, output.length - 500);
  broadcast();
}

function snapshot(): AppSnapshot {
  return {
    project: projects.current,
    projectPath: projects.path,
    plugins: plugins?.list() ?? [],
    contributions: plugins?.contributions() ?? [],
    output: [...output],
    workers: workers?.list() ?? [],
  };
}

function broadcast(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('machina:snapshot', snapshot());
}

function broadcastUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('machina:updateState', updates.getState());
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090c11',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.setZoomFactor(settings.interfaceScale);
}

async function chooseCreate(): Promise<Awaited<ReturnType<ProjectService['createAt']>> | null> {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Create Machina Project',
    defaultPath: join(app.getPath('documents'), 'Untitled Mechatronics.mechatronics'),
    buttonLabel: 'Create Project',
  });
  if (result.canceled || !result.filePath) return null;
  const root = result.filePath.endsWith('.mechatronics') ? result.filePath : `${result.filePath}.mechatronics`;
  const name = basename(root, '.mechatronics');
  const project = await projects.createAt(root, name);
  await settings.setLastProject(root);
  return project;
}

async function chooseOpen(): Promise<Awaited<ReturnType<ProjectService['load']>> | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open Machina Project',
    properties: ['openDirectory'],
    buttonLabel: 'Open Project',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const project = await projects.load(result.filePaths[0]);
  await settings.setLastProject(result.filePaths[0]);
  return project;
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Create Project…', accelerator: 'CmdOrCtrl+N', click: () => void chooseCreate().then(broadcast) },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => void chooseOpen().then(broadcast) },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => void projects.save().then(broadcast) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: () => mainWindow?.webContents.send('machina:menu', 'commandPalette') },
        { label: 'Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
        {
          label: 'Interface Scale',
          submenu: [0.8, 0.9, 1, 1.1, 1.25, 1.5].map((factor) => ({
            label: `${Math.round(factor * 100)}%`,
            type: 'radio' as const,
            checked: settings.interfaceScale === factor,
            click: () => {
              mainWindow?.webContents.setZoomFactor(factor);
              void settings.setInterfaceScale(factor);
            },
          })),
        },
        { type: 'separator' },
        {
          label: 'Workspaces',
          submenu: [
            { label: 'System', type: 'radio', checked: true, click: () => mainWindow?.webContents.send('machina:menu', 'workspace:system') },
            { label: 'Mechanical', type: 'radio', click: () => mainWindow?.webContents.send('machina:menu', 'workspace:mechanical') },
            { label: 'Electrical', type: 'radio', click: () => mainWindow?.webContents.send('machina:menu', 'workspace:electrical') },
            { label: 'Software', type: 'radio', click: () => mainWindow?.webContents.send('machina:menu', 'workspace:software') },
          ],
        },
        {
          label: 'Windows',
          submenu: [
            { label: 'Project', click: () => mainWindow?.webContents.send('machina:menu', 'window:project') },
            { label: 'System Model', click: () => mainWindow?.webContents.send('machina:menu', 'window:viewer') },
            { label: 'Console', click: () => mainWindow?.webContents.send('machina:menu', 'window:console') },
            { label: 'Inspector', click: () => mainWindow?.webContents.send('machina:menu', 'window:inspector') },
            { label: 'Plugin Library', click: () => mainWindow?.webContents.send('machina:menu', 'window:extensions') },
          ],
        },
        {
          label: 'Tile Windows',
          submenu: [
            { label: 'Grid', accelerator: 'CmdOrCtrl+Alt+G', click: () => mainWindow?.webContents.send('machina:menu', 'tiling:grid') },
            { label: 'Rows', click: () => mainWindow?.webContents.send('machina:menu', 'tiling:rows') },
            { label: 'Columns', click: () => mainWindow?.webContents.send('machina:menu', 'tiling:columns') },
            { label: 'Cascade', click: () => mainWindow?.webContents.send('machina:menu', 'tiling:cascade') },
            { type: 'separator' },
            { label: 'Freeform', click: () => mainWindow?.webContents.send('machina:menu', 'tiling:floating') },
          ],
        },
        ...(!app.isPackaged ? [
          { type: 'separator' as const },
          { role: 'reload' as const },
          { role: 'toggleDevTools' as const },
        ] : []),
      ],
    },
    {
      label: 'Plugins',
      submenu: [
        { label: 'Plugin Library', accelerator: 'CmdOrCtrl+Shift+X', click: () => mainWindow?.webContents.send('machina:menu', 'window:extensions') },
        { label: 'Check for Plugin Updates', click: () => void marketplace.getLibrary(true).then(() => mainWindow?.webContents.send('machina:menu', 'window:extensions')).catch((error) => appendOutput('Plugin Library', 'error', error instanceof Error ? error.message : String(error))) },
        ...(!app.isPackaged ? [
          { type: 'separator' as const },
          { label: 'Reload Installed Plugins', click: () => void plugins.discover() },
          { label: 'Open Development Plugin Folder', click: () => void shell.openPath(join(app.getPath('userData'), 'plugins')) },
        ] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => void updates.check() },
        { type: 'separator' },
        { label: 'Machina IDE on GitHub', click: () => void shell.openExternal('https://github.com/TararaDotJoshua/Machina_IDE') },
        { label: 'About Machina IDE', click: () => void dialog.showMessageBox(mainWindow!, { type: 'info', title: 'About Machina IDE', message: `Machina IDE ${app.getVersion()}`, detail: 'Desktop-first mechatronics engineering workspace.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('machina:getSnapshot', () => snapshot());
  ipcMain.handle('machina:project:create', () => chooseCreate());
  ipcMain.handle('machina:project:open', () => chooseOpen());
  ipcMain.handle('machina:project:save', () => projects.save());
  ipcMain.handle('machina:project:updateItem', (_event, id: string, patch: Record<string, unknown>) => projects.updateItem(id, patch));
  ipcMain.handle('machina:project:createFolder', (_event, parentId?: string | null) => projects.createFolder(parentId ?? null));
  ipcMain.handle('machina:project:moveItem', (_event, id: string, parentId: string | null, order: number) => projects.moveItem(id, parentId, order));
  ipcMain.handle('machina:project:reorderItems', (_event, parentId: string | null, itemIds: string[]) => projects.reorderItems(parentId, itemIds));
  ipcMain.handle('machina:project:readAsset', (_event, relativePath: string) => projects.readAsset(relativePath));
  ipcMain.handle('machina:plugins:setEnabled', (_event, id: string, enabled: boolean) => plugins.setEnabled(id, enabled));
  ipcMain.handle('machina:plugins:reload', () => plugins.discover());
  ipcMain.handle('machina:plugins:activateEvent', (_event, activationEvent: string) => plugins.activateEvent(activationEvent));
  ipcMain.handle('machina:plugins:getLibrary', (_event, refresh?: boolean) => marketplace.getLibrary(Boolean(refresh)));
  ipcMain.handle('machina:plugins:install', (_event, id: string) => marketplace.install(id));
  ipcMain.handle('machina:plugins:uninstall', (_event, id: string) => marketplace.uninstall(id));
  ipcMain.handle('machina:commands:execute', (_event, id: string, args?: unknown) => plugins.executeCommand(id, args));
  ipcMain.handle('machina:workers:cancel', (_event, id: string) => workers.cancel(id));
  ipcMain.handle('machina:ai:invoke', (_event, pluginId: string, name: string, input: unknown) => plugins.invokeTool(pluginId, name, input));
  ipcMain.handle('machina:updates:getState', () => updates.getState());
  ipcMain.handle('machina:updates:check', () => updates.check());
  ipcMain.handle('machina:updates:install', () => updates.install());
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new SettingsStore(join(userData, 'settings.json'));
  await settings.load();
  workers = new WorkerManager();
  updates = new UpdateService(autoUpdater, {
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    log: (level, message) => appendOutput('Updater', level, message),
    beforeInstall: async () => {
      if (projects.current) await projects.save();
      workers.stopAll();
      await plugins.deactivateAll();
    },
  });
  const bundledRoot = app.isPackaged ? join(process.resourcesPath, 'plugins') : resolve('plugins');
  const hostRunner = app.isPackaged
    ? join(process.resourcesPath, 'plugin-runtime', 'host-runner.cjs')
    : resolve('dist', 'plugin-runtime', 'host-runner.cjs');
  plugins = new PluginManager(
    bundledRoot,
    join(userData, 'plugins'),
    hostRunner,
    settings,
    projects,
    workers,
    async (options) => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: options.title ?? 'Open File',
        properties: ['openFile'],
        filters: [{ name: 'Supported files', extensions: options.extensions }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  );
  const localCatalogPath = app.isPackaged
    ? join(process.resourcesPath, 'marketplace', 'catalog.json')
    : resolve('marketplace', 'catalog.json');
  marketplace = new PluginMarketplace(localCatalogPath, join(userData, 'plugins'), plugins);
  projects.on('change', broadcast);
  plugins.on('change', broadcast);
  plugins.on('output', ({ source, level, message }) => appendOutput(source, level, message));
  workers.on('change', broadcast);
  workers.on('output', ({ source, level, message }) => appendOutput(source, level, message));
  updates.on('change', broadcastUpdate);
  await mkdir(join(userData, 'projects'), { recursive: true });
  if (settings.lastProject) {
    try {
      await projects.load(settings.lastProject);
    } catch (error) {
      appendOutput('Project', 'warn', `Could not reopen the last project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await plugins.discover();
  registerIpc();
  buildMenu();
  await createWindow();
  broadcast();
  updates.initialize();
  broadcastUpdate();
  if (app.isPackaged) {
    setTimeout(() => void updates.check(), 10_000);
    updateInterval = setInterval(() => void updates.check(), 4 * 60 * 60 * 1000);
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on('before-quit', () => {
  if (updateInterval) clearInterval(updateInterval);
  workers?.stopAll();
  void plugins?.deactivateAll();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
