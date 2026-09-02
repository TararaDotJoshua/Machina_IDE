import { EventEmitter } from 'node:events';
import type { UpdateState } from '@mechatronics-ide/core';

interface UpdateInfo {
  version?: string;
}

interface DownloadProgress {
  percent?: number;
  transferred?: number;
  total?: number;
}

export interface UpdateBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface UpdateServiceOptions {
  packaged: boolean;
  currentVersion: string;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  beforeInstall(): Promise<void>;
}

export class UpdateService extends EventEmitter {
  private state: UpdateState;
  private initialized = false;
  private checkPromise: Promise<UpdateState> | null = null;

  constructor(private readonly backend: UpdateBackend, private readonly options: UpdateServiceOptions) {
    super();
    this.state = {
      status: options.packaged ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      message: options.packaged ? 'Ready to check for updates' : 'Updates are available in packaged builds',
    };
  }

  initialize(): void {
    if (this.initialized || !this.options.packaged) return;
    this.initialized = true;
    this.backend.autoDownload = true;
    this.backend.autoInstallOnAppQuit = true;
    this.backend.allowPrerelease = false;
    this.backend.channel = 'latest';
    this.backend.on('checking-for-update', () => this.setState({ status: 'checking', message: 'Checking for updates' }));
    this.backend.on('update-available', (value) => {
      const info = value as UpdateInfo;
      this.setState({ status: 'available', ...(info.version ? { availableVersion: info.version } : {}), message: `Downloading Machina ${info.version ?? 'update'}` });
    });
    this.backend.on('download-progress', (value) => {
      const progress = value as DownloadProgress;
      this.setState({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, progress.percent ?? 0)),
        ...(progress.transferred === undefined ? {} : { transferred: progress.transferred }),
        ...(progress.total === undefined ? {} : { total: progress.total }),
        message: 'Downloading update',
      });
    });
    this.backend.on('update-not-available', (value) => {
      const info = value as UpdateInfo;
      this.setState({ status: 'not-available', ...(info.version ? { availableVersion: info.version } : {}), message: 'Machina is up to date', checkedAt: new Date().toISOString() });
    });
    this.backend.on('update-downloaded', (value) => {
      const info = value as UpdateInfo;
      this.setState({ status: 'downloaded', ...(info.version ? { availableVersion: info.version } : {}), percent: 100, message: 'Update ready to install', checkedAt: new Date().toISOString() });
      this.options.log('info', `Machina ${info.version ?? 'update'} downloaded and ready to install`);
    });
    this.backend.on('error', (value) => {
      const message = value instanceof Error ? value.message : String(value);
      this.setState({ status: 'error', message, checkedAt: new Date().toISOString() });
      this.options.log('error', `Update check failed: ${message}`);
    });
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async check(): Promise<UpdateState> {
    if (!this.options.packaged) return this.getState();
    if (this.checkPromise) return this.checkPromise;
    if (this.state.status === 'downloading') return this.getState();
    this.checkPromise = this.runCheck();
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private async runCheck(): Promise<UpdateState> {
    this.setState({ status: 'checking', message: 'Checking for updates' });
    try {
      await this.backend.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.state.status !== 'error' || this.state.message !== message) {
        this.setState({ status: 'error', message, checkedAt: new Date().toISOString() });
        this.options.log('error', `Update check failed: ${message}`);
      }
    }
    return this.getState();
  }

  async install(): Promise<void> {
    if (this.state.status !== 'downloaded') throw new Error('No downloaded update is ready to install');
    await this.options.beforeInstall();
    this.options.log('info', 'Restarting Machina to install the update');
    this.backend.quitAndInstall(false, true);
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.getState());
  }
}
