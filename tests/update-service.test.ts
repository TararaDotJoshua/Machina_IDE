import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateBackend } from '../src/main/update-service';

class FakeUpdater extends EventEmitter implements UpdateBackend {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  channel: string | null = null;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

function createService(packaged = true): { backend: FakeUpdater; service: UpdateService; beforeInstall: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } {
  const backend = new FakeUpdater();
  const beforeInstall = vi.fn(async () => undefined);
  const log = vi.fn();
  const service = new UpdateService(backend, {
    packaged,
    currentVersion: '1.0.0-beta.2',
    log,
    beforeInstall,
  });
  return { backend, service, beforeInstall, log };
}

describe('UpdateService', () => {
  it('disables network checks in development', async () => {
    const { backend, service } = createService(false);
    service.initialize();
    expect((await service.check()).status).toBe('disabled');
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
  });

  it('configures the beta channel and publishes download progress', () => {
    const { backend, service } = createService();
    service.initialize();
    backend.emit('update-available', { version: '1.0.0-beta.3' });
    backend.emit('download-progress', { percent: 42.4, transferred: 424, total: 1000 });
    expect(backend.autoDownload).toBe(false);
    expect(backend.allowPrerelease).toBe(true);
    expect(backend.channel).toBe('beta');
    expect(backend.downloadUpdate).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({ status: 'downloading', percent: 42.4, transferred: 424, total: 1000 });
  });

  it('saves state before restarting into a downloaded update', async () => {
    const { backend, service, beforeInstall } = createService();
    service.initialize();
    backend.emit('update-downloaded', { version: '1.0.0-beta.3' });
    await service.install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(backend.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('blocks older, equal, and invalid update versions before download or install', async () => {
    const { backend, service, beforeInstall, log } = createService();
    service.initialize();
    backend.emit('update-available', { version: '1.0.0-beta.1' });
    backend.emit('update-downloaded', { version: '1.0.0-beta.1' });
    expect(service.getState()).toMatchObject({ status: 'not-available' });
    expect(backend.downloadUpdate).not.toHaveBeenCalled();
    await expect(service.install()).rejects.toThrow('No downloaded update');
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('not newer'));
  });

  it('logs a failed check once when the backend also emits the error', async () => {
    const { backend, service, log } = createService();
    const error = new Error('Update service unavailable');
    backend.checkForUpdates.mockImplementationOnce(async () => {
      backend.emit('error', error);
      throw error;
    });
    service.initialize();
    const state = await service.check();
    expect(state).toMatchObject({ status: 'error', message: error.message });
    expect(log).toHaveBeenCalledOnce();
  });
});
