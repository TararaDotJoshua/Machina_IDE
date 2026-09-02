import { EventEmitter } from 'node:events';
import { fork, type ChildProcess } from 'node:child_process';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import semver from 'semver';
import {
  API_VERSION,
  APP_VERSION,
  pluginManifestSchema,
  rpcRequestSchema,
  rpcResponseSchema,
  type OutputEntry,
  type Permission,
  type PluginDescriptor,
  type PluginManifest,
  type RpcRequest,
  type RpcResponse,
} from '@mechatronics-ide/core';
import { ProjectService } from './project-service';
import { SettingsStore } from './settings-store';
import { WorkerManager } from './worker-manager';

interface HostRecord {
  child: ChildProcess;
  pending: Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>;
}

const userAllowedPermissions = new Set<Permission>([
  'project.read',
  'project.write',
  'ui.panels',
  'ai.tools',
  'viewport.selection',
]);

export class PluginManager extends EventEmitter {
  private plugins: PluginDescriptor[] = [];
  private readonly hosts = new Map<string, HostRecord>();

  constructor(
    private readonly bundledRoot: string,
    private readonly userRoot: string,
    private readonly hostRunner: string,
    private readonly settings: SettingsStore,
    private readonly projects: ProjectService,
    private readonly workers: WorkerManager,
  ) {
    super();
  }

  list(): PluginDescriptor[] {
    return structuredClone(this.plugins);
  }

  contributions(): Array<{ pluginId: string; contributes: PluginManifest['contributes'] }> {
    return this.plugins
      .filter((plugin) => plugin.enabled && (plugin.status === 'ready' || plugin.status === 'active') && plugin.manifest)
      .map((plugin) => ({ pluginId: plugin.id, contributes: plugin.manifest!.contributes }));
  }

  async discover(): Promise<void> {
    await this.deactivateAll();
    await mkdir(this.userRoot, { recursive: true });
    const candidates = [
      ...(await this.scanRoot(this.bundledRoot, 'bundled')),
      ...(await this.scanRoot(this.userRoot, 'user')),
    ];
    const duplicateIds = new Set<string>();
    const counts = new Map<string, number>();
    for (const plugin of candidates) counts.set(plugin.id, (counts.get(plugin.id) ?? 0) + 1);
    for (const [id, count] of counts) if (count > 1) duplicateIds.add(id);
    for (const plugin of candidates) {
      if (duplicateIds.has(plugin.id)) {
        plugin.status = 'invalid';
        plugin.enabled = false;
        plugin.diagnostics.push({ level: 'error', message: `Duplicate plugin id: ${plugin.id}` });
      }
    }
    this.plugins = candidates;
    this.emit('change');
    await this.activateEvent('onStartupFinished');
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.status === 'invalid') throw new Error('Invalid plugins cannot be enabled');
    await this.settings.setPluginEnabled(pluginId, enabled);
    plugin.enabled = enabled;
    if (!enabled) {
      await this.deactivate(plugin);
      plugin.status = 'disabled';
    } else {
      plugin.status = 'ready';
      if (plugin.manifest?.activationEvents.includes('onStartupFinished')) await this.activate(plugin);
    }
    this.emit('change');
  }

  async activateEvent(event: string): Promise<void> {
    const matches = this.plugins.filter(
      (plugin) =>
        plugin.enabled &&
        plugin.manifest &&
        (plugin.status === 'ready' || plugin.status === 'active') &&
        plugin.manifest.activationEvents.includes(event),
    );
    await Promise.all(matches.map((plugin) => this.activate(plugin)));
  }

  async executeCommand(commandId: string, args?: unknown): Promise<unknown> {
    await this.activateEvent(`onCommand:${commandId}`);
    const plugin = this.plugins.find(
      (item) => item.enabled && item.manifest?.contributes.commands.some((command) => command.id === commandId),
    );
    if (!plugin) throw new Error(`Unknown plugin command: ${commandId}`);
    await this.activate(plugin);
    return this.call(plugin.id, 'command.execute', { id: commandId, args });
  }

  async invokeTool(pluginId: string, name: string, input: unknown): Promise<unknown> {
    const plugin = this.requirePlugin(pluginId);
    if (!plugin.enabled || !plugin.manifest?.contributes.aiTools.some((tool) => tool.name === name)) {
      throw new Error(`Tool is not available: ${name}`);
    }
    await this.activate(plugin);
    return this.call(pluginId, 'ai.invoke', { name, input });
  }

  async deactivateAll(): Promise<void> {
    await Promise.all(this.plugins.map((plugin) => this.deactivate(plugin)));
    this.workers.stopAll();
  }

  private async scanRoot(root: string, source: 'bundled' | 'user'): Promise<PluginDescriptor[]> {
    try {
      await access(root);
    } catch {
      return [];
    }
    const entries = await readdir(root, { withFileTypes: true });
    const results: PluginDescriptor[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginRoot = resolve(root, entry.name);
      const diagnostics: PluginDescriptor['diagnostics'] = [];
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(resolve(pluginRoot, 'manifest.json'), 'utf8')) as unknown;
      } catch (error) {
        results.push({
          id: `invalid.${entry.name}`,
          name: entry.name,
          path: pluginRoot,
          source,
          enabled: false,
          status: 'invalid',
          diagnostics: [{ level: 'error', message: `Cannot read manifest: ${messageOf(error)}` }],
        });
        continue;
      }
      const parsed = pluginManifestSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({
          id: typeof (raw as any)?.id === 'string' ? (raw as any).id : `invalid.${entry.name}`,
          name: typeof (raw as any)?.name === 'string' ? (raw as any).name : entry.name,
          path: pluginRoot,
          source,
          enabled: false,
          status: 'invalid',
          diagnostics: parsed.error.issues.map((issue) => ({
            level: 'error' as const,
            message: `${issue.path.join('.') || 'manifest'}: ${issue.message}`,
          })),
        });
        continue;
      }
      const manifest = parsed.data;
      if (!semver.satisfies(APP_VERSION, manifest.engines.mechatronicsIDE)) {
        diagnostics.push({
          level: 'error',
          message: `Requires Machina IDE ${manifest.engines.mechatronicsIDE}; current version is ${APP_VERSION}`,
        });
      }
      for (const field of ['main', 'renderer'] as const) {
        const value = manifest[field];
        if (!value) continue;
        const candidate = resolve(pluginRoot, value);
        if (!safeChild(pluginRoot, candidate)) diagnostics.push({ level: 'error', message: `${field} escapes plugin root` });
        else {
          try { await access(candidate); } catch { diagnostics.push({ level: 'error', message: `Missing ${field} entry: ${value}` }); }
        }
      }
      for (const worker of manifest.contributes.workers) {
        const candidate = resolve(pluginRoot, worker.entry);
        if (!safeChild(pluginRoot, candidate)) diagnostics.push({ level: 'error', message: `Worker ${worker.id} escapes plugin root` });
        else {
          try { await access(candidate); } catch { diagnostics.push({ level: 'error', message: `Missing worker entry: ${worker.entry}` }); }
        }
      }
      if (source === 'user') {
        for (const permission of manifest.permissions) {
          if (!userAllowedPermissions.has(permission)) diagnostics.push({ level: 'error', message: `Permission denied by user-plugin policy: ${permission}` });
        }
      }
      const invalid = diagnostics.some((diagnostic) => diagnostic.level === 'error');
      const enabled = !invalid && this.settings.isPluginEnabled(manifest.id);
      results.push({
        manifest,
        id: manifest.id,
        name: manifest.name,
        path: pluginRoot,
        source,
        enabled,
        status: invalid ? 'invalid' : enabled ? 'ready' : 'disabled',
        diagnostics,
      });
    }
    return results;
  }

  private async activate(plugin: PluginDescriptor): Promise<void> {
    if (plugin.status === 'active') return;
    if (!plugin.enabled || !plugin.manifest || plugin.status === 'invalid') return;
    if (!plugin.manifest.main) {
      plugin.status = 'active';
      this.emit('change');
      return;
    }
    const entry = resolve(plugin.path, plugin.manifest.main);
    const child = fork(this.hostRunner, [entry], {
      silent: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_CRASHPAD: '1' },
    });
    const record: HostRecord = { child, pending: new Map() };
    this.hosts.set(plugin.id, record);
    child.stdout?.on('data', (data) => this.output(plugin.id, 'info', String(data).trimEnd()));
    child.stderr?.on('data', (data) => {
      const message = String(data).trimEnd();
      // Packaged Electron-as-Node children can emit a benign crashpad pipe race at boot.
      if (!isCrashpadPipeNoise(message)) this.output(plugin.id, 'error', message);
    });
    child.on('message', (raw) => void this.onHostMessage(plugin, raw));
    child.on('exit', (code) => {
      const wasActive = this.hosts.delete(plugin.id);
      if (wasActive && plugin.enabled && plugin.status === 'active') {
        plugin.status = 'failed';
        plugin.diagnostics.push({ level: 'error', message: `Plugin host exited unexpectedly (${code ?? 'unknown'})` });
        this.output(plugin.id, 'error', `Plugin host crashed; contributions were removed`);
        this.emit('change');
      }
    });
    try {
      await this.call(plugin.id, 'activate', { pluginId: plugin.id, permissions: plugin.manifest.permissions });
      plugin.status = 'active';
      this.output(plugin.id, 'info', `Activated ${plugin.name} ${plugin.manifest.version}`);
    } catch (error) {
      plugin.status = 'failed';
      plugin.diagnostics.push({ level: 'error', message: `Activation failed: ${messageOf(error)}` });
      child.kill();
      this.hosts.delete(plugin.id);
    }
    this.emit('change');
  }

  private async deactivate(plugin: PluginDescriptor): Promise<void> {
    const host = this.hosts.get(plugin.id);
    this.workers.stopPlugin(plugin.id);
    if (!host) return;
    try { await this.call(plugin.id, 'deactivate', undefined, 3_000); } catch { /* contained */ }
    this.hosts.delete(plugin.id);
    host.child.kill();
    if (plugin.enabled && plugin.status !== 'invalid') plugin.status = 'ready';
  }

  private call(pluginId: string, method: string, params?: unknown, timeoutMs = 10_000): Promise<unknown> {
    const host = this.hosts.get(pluginId);
    if (!host?.child.connected) return Promise.reject(new Error(`Plugin host is unavailable: ${pluginId}`));
    const id = randomUUID();
    const request: RpcRequest = { v: API_VERSION, kind: 'request', id, method, ...(params === undefined ? {} : { params }) };
    host.child.send(request);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        host.pending.delete(id);
        reject(new Error(`Plugin request timed out: ${method}`));
      }, timeoutMs);
      host.pending.set(id, { resolve: resolvePromise, reject, timer });
    });
  }

  private async onHostMessage(plugin: PluginDescriptor, raw: unknown): Promise<void> {
    const response = rpcResponseSchema.safeParse(raw);
    if (response.success) {
      const host = this.hosts.get(plugin.id);
      const waiter = host?.pending.get(response.data.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      host!.pending.delete(response.data.id);
      if (response.data.ok) waiter.resolve(response.data.result);
      else waiter.reject(new Error(response.data.error ?? 'Plugin request failed'));
      return;
    }
    const request = rpcRequestSchema.safeParse(raw);
    if (!request.success) {
      this.output(plugin.id, 'error', 'Rejected malformed RPC message from plugin host');
      return;
    }
    let responseMessage: RpcResponse;
    try {
      const result = await this.handleHostRequest(plugin, request.data);
      responseMessage = { v: API_VERSION, kind: 'response', id: request.data.id, ok: true, result };
    } catch (error) {
      this.output(plugin.id, 'error', `Denied/failed request ${request.data.method}: ${messageOf(error)}`);
      responseMessage = { v: API_VERSION, kind: 'response', id: request.data.id, ok: false, error: messageOf(error) };
    }
    this.hosts.get(plugin.id)?.child.send(responseMessage);
  }

  private async handleHostRequest(plugin: PluginDescriptor, request: RpcRequest): Promise<unknown> {
    const params = request.params as any;
    switch (request.method) {
      case 'log':
        this.output(plugin.id, params.level ?? 'info', String(params.message));
        return null;
      case 'project.getState':
        this.assertPermission(plugin, 'project.read');
        return this.projects.getPluginState(plugin.id);
      case 'project.setState':
        this.assertPermission(plugin, 'project.write');
        await this.projects.setPluginState(plugin.id, params.state);
        return null;
      case 'worker.start': {
        this.assertPermission(plugin, 'process.worker');
        const worker = plugin.manifest!.contributes.workers.find((item) => item.id === params.workerId);
        if (!worker) throw new Error(`Worker is not declared: ${params.workerId}`);
        return this.workers.start(plugin.id, plugin.path, worker, params.args);
      }
      default:
        throw new Error(`Unsupported host capability: ${request.method}`);
    }
  }

  private assertPermission(plugin: PluginDescriptor, permission: Permission): void {
    if (!plugin.manifest?.permissions.includes(permission)) throw new Error(`Permission denied: ${permission}`);
  }

  private requirePlugin(pluginId: string): PluginDescriptor {
    const plugin = this.plugins.find((item) => item.id === pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    return plugin;
  }

  private output(source: string, level: OutputEntry['level'], message: string): void {
    if (message) this.emit('output', { source, level, message });
  }
}

function safeChild(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCrashpadPipeNoise(message: string): boolean {
  return message.includes('crashpad') && message.includes('TransactNamedPipe');
}
