import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import semver from 'semver';
import {
  APP_VERSION,
  marketplaceCatalogSchema,
  pluginManifestSchema,
  type MarketplaceCatalog,
  type MarketplacePlugin,
  type Permission,
  type PluginLibraryState,
} from '@mechatronics-ide/core';
import { PluginManager } from './plugin-manager';

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/TararaDotJoshua/Machina_IDE/main/marketplace/catalog.json';
const userAllowedPermissions = new Set<Permission>([
  'project.read',
  'project.write',
  'ui.panels',
  'ai.tools',
  'viewport.selection',
]);

export class PluginMarketplace {
  private catalog: MarketplaceCatalog | null = null;
  private registryOnline = false;
  private message: string | undefined;

  constructor(
    private readonly localCatalogPath: string,
    private readonly userPluginRoot: string,
    private readonly plugins: PluginManager,
    private readonly registryUrl: string | null = DEFAULT_REGISTRY_URL,
  ) {}

  async getLibrary(refresh = false): Promise<PluginLibraryState> {
    if (!this.catalog || refresh) await this.refresh();
    const installed = new Map(this.plugins.list().map((plugin) => [plugin.id, plugin]));
    const entries = (this.catalog?.plugins ?? []).map((entry) => {
      const plugin = installed.get(entry.id);
      return {
        ...entry,
        ...(plugin?.manifest?.version ? { installedVersion: plugin.manifest.version } : {}),
        ...(plugin ? { installedSource: plugin.source, enabled: plugin.enabled, status: plugin.status } : {}),
        updateAvailable: Boolean(plugin?.manifest?.version && semver.gt(entry.version, plugin.manifest.version)),
      };
    });
    for (const plugin of installed.values()) {
      if (entries.some((entry) => entry.id === plugin.id)) continue;
      entries.push({
        id: plugin.id,
        name: plugin.name,
        version: plugin.manifest?.version ?? '0.0.0',
        description: plugin.status === 'invalid' ? 'This locally installed plugin did not pass validation.' : 'Locally installed plugin.',
        publisher: plugin.source === 'bundled' ? 'Machina' : 'Local',
        license: 'Not specified',
        categories: [],
        verified: plugin.source === 'bundled',
        bundled: plugin.source === 'bundled',
        engines: plugin.manifest?.engines ?? { mechatronicsIDE: '*' },
        permissions: plugin.manifest?.permissions ?? [],
        installedVersion: plugin.manifest?.version ?? '0.0.0',
        installedSource: plugin.source,
        enabled: plugin.enabled,
        status: plugin.status,
        updateAvailable: false,
      });
    }
    return {
      entries,
      refreshedAt: new Date().toISOString(),
      registryOnline: this.registryOnline,
      ...(this.message ? { message: this.message } : {}),
    };
  }

  async install(pluginId: string): Promise<void> {
    if (!this.catalog) await this.refresh();
    const entry = this.catalog?.plugins.find((plugin) => plugin.id === pluginId);
    if (!entry) throw new Error('Plugin is not available in the library');
    if (entry.bundled) throw new Error('This plugin ships with Machina and does not need to be installed');
    if (!entry.download) throw new Error('Plugin package is unavailable');
    if (!semver.satisfies(APP_VERSION, entry.engines.mechatronicsIDE)) {
      throw new Error(`Requires Machina IDE ${entry.engines.mechatronicsIDE}`);
    }
    const existing = this.plugins.list().find((plugin) => plugin.id === pluginId);
    if (existing?.source === 'bundled') throw new Error('Bundled plugins cannot be replaced from the marketplace');

    const archive = await download(entry.download.url, entry.download.sizeBytes, DOWNLOAD_TIMEOUT_MS);
    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest !== entry.download.sha256) throw new Error('Plugin package failed its integrity check');
    await this.installArchive(entry, archive);
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.plugins.list().find((candidate) => candidate.id === pluginId);
    if (!plugin) throw new Error('Plugin is not installed');
    if (plugin.source !== 'user') throw new Error('Bundled plugins cannot be removed');
    const target = resolve(plugin.path);
    if (!safeChild(this.userPluginRoot, target)) throw new Error('Refusing to remove a plugin outside the user plugin directory');
    await this.plugins.deactivateAll();
    const quarantine = resolve(this.userPluginRoot, `.remove-${randomUUID()}`);
    await rename(target, quarantine);
    try {
      await rm(quarantine, { recursive: true, force: true });
      await this.plugins.discover();
    } catch (error) {
      await rename(quarantine, target).catch(() => undefined);
      await this.plugins.discover();
      throw error;
    }
  }

  private async refresh(): Promise<void> {
    const local = marketplaceCatalogSchema.parse(JSON.parse(await readFile(this.localCatalogPath, 'utf8')));
    if (!this.registryUrl) {
      this.catalog = local;
      this.registryOnline = false;
      this.message = undefined;
      return;
    }
    try {
      const remoteBytes = await download(this.registryUrl, MAX_CATALOG_BYTES, DOWNLOAD_TIMEOUT_MS);
      const remote = marketplaceCatalogSchema.parse(JSON.parse(remoteBytes.toString('utf8')));
      this.catalog = mergeCatalogs(local, remote);
      this.registryOnline = true;
      this.message = undefined;
    } catch {
      this.catalog = local;
      this.registryOnline = false;
      this.message = 'Using the built-in catalog. Connect to the internet to check for new plugins.';
    }
  }

  private async installArchive(entry: MarketplacePlugin, archiveBytes: Buffer): Promise<void> {
    if (archiveBytes.length > MAX_ARCHIVE_BYTES) throw new Error('Plugin package is too large');
    const zip = new AdmZip(archiveBytes);
    const zipEntries = zip.getEntries();
    if (zipEntries.length === 0 || zipEntries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Plugin package has an invalid number of files');
    const totalSize = zipEntries.reduce((sum, zipEntry) => sum + zipEntry.header.size, 0);
    if (totalSize > MAX_EXTRACTED_BYTES) throw new Error('Plugin package expands beyond the allowed size');

    await mkdir(this.userPluginRoot, { recursive: true });
    const staging = resolve(this.userPluginRoot, `.install-${randomUUID()}`);
    const target = resolve(this.userPluginRoot, entry.id);
    const backup = resolve(this.userPluginRoot, `.backup-${randomUUID()}`);
    if (!safeChild(this.userPluginRoot, staging) || !safeChild(this.userPluginRoot, target)) throw new Error('Invalid plugin installation path');
    await mkdir(staging, { recursive: true });
    try {
      const seen = new Set<string>();
      for (const zipEntry of zipEntries) {
        const name = normalizeArchivePath(zipEntry.entryName);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) throw new Error('Plugin package contains an invalid or duplicate path');
        seen.add(key);
        if (isSymlink(zipEntry.attr)) throw new Error('Plugin packages cannot contain symbolic links');
        const destination = resolve(staging, name);
        if (!safeChild(staging, destination)) throw new Error('Plugin package contains a path outside its root');
        if (zipEntry.isDirectory) await mkdir(destination, { recursive: true });
        else {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, zipEntry.getData());
        }
      }
      await validateExtractedPlugin(staging, entry);
      await this.plugins.deactivateAll();
      const targetExists = await exists(target);
      if (targetExists) await rename(target, backup);
      try {
        await rename(staging, target);
        await this.plugins.discover();
        const installed = this.plugins.list().find((plugin) => plugin.id === entry.id && plugin.source === 'user');
        if (!installed || installed.status === 'invalid') throw new Error(installed?.diagnostics[0]?.message ?? 'Installed plugin did not pass validation');
        if (targetExists) await rm(backup, { recursive: true, force: true });
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        if (targetExists) await rename(backup, target);
        await this.plugins.discover();
        throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

async function validateExtractedPlugin(root: string, catalogEntry: MarketplacePlugin): Promise<void> {
  const manifest = pluginManifestSchema.parse(JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')));
  if (manifest.id !== catalogEntry.id || manifest.version !== catalogEntry.version) throw new Error('Plugin manifest does not match the marketplace listing');
  if (!semver.satisfies(APP_VERSION, manifest.engines.mechatronicsIDE)) throw new Error(`Plugin requires Machina IDE ${manifest.engines.mechatronicsIDE}`);
  for (const permission of manifest.permissions) {
    if (!userAllowedPermissions.has(permission)) throw new Error(`Marketplace plugins cannot request ${permission}`);
  }
  const files = [manifest.main, manifest.renderer, ...manifest.contributes.workers.map((worker) => worker.entry)].filter((value): value is string => Boolean(value));
  for (const file of files) {
    const candidate = resolve(root, file);
    if (!safeChild(root, candidate) || !(await exists(candidate))) throw new Error(`Plugin entry is missing or unsafe: ${file}`);
  }
}

async function download(url: string, maximumBytes: number, timeoutMs: number): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Downloads must use HTTPS');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
    if (new URL(response.url).protocol !== 'https:') throw new Error('Download redirected to an insecure location');
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maximumBytes) throw new Error('Download exceeds the allowed size');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maximumBytes) throw new Error('Download exceeds the allowed size');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

function mergeCatalogs(local: MarketplaceCatalog, remote: MarketplaceCatalog): MarketplaceCatalog {
  const entries = new Map(local.plugins.map((plugin) => [plugin.id, plugin]));
  for (const plugin of remote.plugins) {
    const existing = entries.get(plugin.id);
    if (existing?.bundled || plugin.bundled) continue;
    if (!existing || semver.gte(plugin.version, existing.version)) entries.set(plugin.id, plugin);
  }
  return { schemaVersion: 1, updatedAt: remote.updatedAt, plugins: [...entries.values()] };
}

function normalizeArchivePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.includes('\0') || normalized.includes(':') || normalized.startsWith('/')) return '';
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) return '';
  return normalized;
}

function isSymlink(attributes: number): boolean {
  return ((attributes >>> 16) & 0o170000) === 0o120000;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function safeChild(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value);
}
