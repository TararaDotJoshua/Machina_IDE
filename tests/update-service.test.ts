import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateBackend } from '../src/main/update-service';

class FakeUpdater extends EventEmitter implements UpdateBackend {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  channel: string | null = null;
  checkForUpdates = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

function createService(packaged = true): { backend: FakeUpdater; service: UpdateService; beforeInstall: ReturnType<typeof vi.fn> } {
  const backend = new FakeUpdater();
  const beforeInstall = vi.fn(async () => undefined);
  const service = new UpdateService(backend, {
    packaged,
    currentVersion: '0.2.0-beta.2',
    log: vi.fn(),
    beforeInstall,
  });
  return { backend, service, beforeInstall };
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
    backend.emit('update-available', { version: '0.2.0-beta.3' });
    backend.emit('download-progress', { percent: 42.4, transferred: 424, total: 1000 });
    expect(backend.autoDownload).toBe(true);
    expect(backend.allowPrerelease).toBe(true);
    expect(backend.channel).toBe('beta');
    expect(service.getState()).toMatchObject({ status: 'downloading', percent: 42.4, transferred: 424, total: 1000 });
  });

  it('saves state before restarting into a downloaded update', async () => {
    const { backend, service, beforeInstall } = createService();
    service.initialize();
    backend.emit('update-downloaded', { version: '0.2.0-beta.3' });
    await service.install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(backend.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
