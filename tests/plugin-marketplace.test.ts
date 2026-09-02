import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginDescriptor } from '@mechatronics-ide/core';
import { PluginMarketplace } from '../src/main/plugin-marketplace';
import type { PluginManager } from '../src/main/plugin-manager';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('plugin marketplace', () => {
  it('merges the built-in catalog with installed plugins', async () => {
    const root = await temporaryRoot();
    const catalogPath = join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(catalog('dev.machina.bundled', true)), 'utf8');
    const manager = fakeManager(root, [{
      id: 'com.acme.local', name: 'Local Tool', path: join(root, 'com.acme.local'), source: 'user', enabled: true, status: 'ready', diagnostics: [],
    }]);
    const marketplace = new PluginMarketplace(catalogPath, root, manager, null);

    const library = await marketplace.getLibrary();

    expect(library.entries.map((entry) => entry.id)).toEqual(['dev.machina.bundled', 'com.acme.local']);
    expect(library.entries[1]?.installedSource).toBe('user');
  });

  it('installs a validated archive atomically and preserves its manifest', async () => {
    const root = await temporaryRoot();
    const catalogPath = join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(catalog('dev.machina.bundled', true)), 'utf8');
    const manager = fakeManager(root, []);
    const marketplace = new PluginMarketplace(catalogPath, root, manager, null);
    const entry = {
      ...catalog('com.acme.measure', false).plugins[0]!,
      bundled: false,
      download: { url: 'https://example.invalid/measure.zip', sha256: '0'.repeat(64), sizeBytes: 10_000 },
    };
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      engines: entry.engines,
      activationEvents: [],
      permissions: ['project.read'],
      contributes: {},
    })));

    await (marketplace as unknown as { installArchive(value: typeof entry, bytes: Buffer): Promise<void> }).installArchive(entry, zip.toBuffer());

    const manifest = JSON.parse(await readFile(join(root, entry.id, 'manifest.json'), 'utf8')) as { id: string };
    expect(manifest.id).toBe(entry.id);
    expect(manager.discover).toHaveBeenCalled();
  });

  it('rejects marketplace archives requesting trusted worker access', async () => {
    const root = await temporaryRoot();
    const catalogPath = join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(catalog('dev.machina.bundled', true)), 'utf8');
    const marketplace = new PluginMarketplace(catalogPath, root, fakeManager(root, []), null);
    const entry = {
      ...catalog('com.acme.unsafe', false).plugins[0]!,
      bundled: false,
      download: { url: 'https://example.invalid/unsafe.zip', sha256: '0'.repeat(64), sizeBytes: 10_000 },
    };
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      engines: entry.engines,
      activationEvents: [],
      permissions: ['process.worker'],
      contributes: {},
    })));

    await expect((marketplace as unknown as { installArchive(value: typeof entry, bytes: Buffer): Promise<void> }).installArchive(entry, zip.toBuffer()))
      .rejects.toThrow('Marketplace plugins cannot request process.worker');
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'machina-marketplace-'));
  roots.push(root);
  return root;
}

function catalog(id: string, bundled: boolean) {
  return {
    schemaVersion: 1 as const,
    updatedAt: '2026-09-02T14:00:00.000Z',
    plugins: [{
      id,
      name: id.split('.').at(-1) ?? id,
      version: '1.0.0',
      description: 'Test plugin',
      publisher: 'Test',
      license: 'MIT',
      categories: [],
      verified: false,
      bundled,
      engines: { mechatronicsIDE: '>=1.0.0-beta.2 <2.0.0' },
      permissions: ['project.read' as const],
    }],
  };
}

function fakeManager(root: string, initial: PluginDescriptor[]): PluginManager {
  let plugins = initial;
  return {
    list: () => structuredClone(plugins),
    deactivateAll: vi.fn(async () => undefined),
    discover: vi.fn(async () => {
      try {
        const manifest = JSON.parse(await readFile(join(root, 'com.acme.measure', 'manifest.json'), 'utf8'));
        plugins = [{ id: manifest.id, name: manifest.name, manifest, path: join(root, manifest.id), source: 'user', enabled: true, status: 'ready', diagnostics: [] }];
      } catch { /* no newly installed test plugin */ }
    }),
  } as unknown as PluginManager;
}
