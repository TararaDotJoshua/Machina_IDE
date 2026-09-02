import { pathToFileURL } from 'node:url';
import {
  API_VERSION,
  DisposableStore,
  rpcRequestSchema,
  rpcResponseSchema,
  type Permission,
  type RpcRequest,
  type RpcResponse,
} from '@mechatronics-ide/core';
import type { PluginContext, PluginDefinition } from '@mechatronics-ide/plugin-sdk';

const requestedPluginEntry = process.argv[2];
if (!requestedPluginEntry) throw new Error('Missing plugin entry path');
const pluginEntry: string = requestedPluginEntry;

let definition: PluginDefinition | undefined;
let pluginId = '';
let permissions = new Set<Permission>();
let abortController = new AbortController();
let activationDisposable: { dispose(): void } | undefined;
const registrations = new DisposableStore();
const commands = new Map<string, (args?: unknown) => unknown | Promise<unknown>>();
const tools = new Map<string, (input: unknown) => unknown | Promise<unknown>>();
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let sequence = 0;

function send(message: RpcRequest | RpcResponse): void {
  if (process.send) process.send(message);
}

function call(method: string, params?: unknown): Promise<any> {
  const id = `host-${++sequence}`;
  send({ v: API_VERSION, kind: 'request', id, method, ...(params === undefined ? {} : { params }) });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function requirePermission(permission: Permission): void {
  if (!permissions.has(permission)) {
    void call('log', { level: 'error', message: `Denied capability request: ${permission}` });
    throw new Error(`Permission denied: ${permission}`);
  }
}

function makeContext(): PluginContext {
  return {
    pluginId,
    permissions,
    signal: abortController.signal,
    logger: {
      info: (message) => void call('log', { level: 'info', message }),
      warn: (message) => void call('log', { level: 'warn', message }),
      error: (message) => void call('log', { level: 'error', message }),
    },
    commands: {
      registerCommand: (id, handler) => {
        if (commands.has(id)) throw new Error(`Duplicate command handler: ${id}`);
        commands.set(id, handler);
        return registrations.add({ dispose: () => commands.delete(id) });
      },
    },
    ai: {
      registerTool: (name, handler) => {
        requirePermission('ai.tools');
        if (tools.has(name)) throw new Error(`Duplicate tool handler: ${name}`);
        tools.set(name, handler);
        return registrations.add({ dispose: () => tools.delete(name) });
      },
    },
    project: {
      getState: async () => {
        requirePermission('project.read');
        return call('project.getState');
      },
      setState: async (state) => {
        requirePermission('project.write');
        await call('project.setState', { state });
      },
    },
    workers: {
      start: async (workerId, args) => {
        requirePermission('process.worker');
        return call('worker.start', { workerId, args });
      },
    },
  };
}

async function handle(request: RpcRequest): Promise<unknown> {
  switch (request.method) {
    case 'activate': {
      const params = request.params as { pluginId: string; permissions: Permission[] };
      pluginId = params.pluginId;
      permissions = new Set(params.permissions);
      abortController = new AbortController();
      const loaded = await import(pathToFileURL(pluginEntry).href);
      const candidate = loaded.default ?? loaded;
      definition = ((candidate as { default?: unknown }).default ?? candidate) as PluginDefinition;
      if (!definition?.activate) throw new Error('Plugin entry must export a plugin definition');
      const result = await definition.activate(makeContext());
      if (result && typeof result.dispose === 'function') activationDisposable = result;
      return { commands: [...commands.keys()], tools: [...tools.keys()] };
    }
    case 'command.execute': {
      const params = request.params as { id: string; args?: unknown };
      const handler = commands.get(params.id);
      if (!handler) throw new Error(`No active handler for command: ${params.id}`);
      return handler(params.args);
    }
    case 'ai.invoke': {
      const params = request.params as { name: string; input: unknown };
      const handler = tools.get(params.name);
      if (!handler) throw new Error(`No active handler for tool: ${params.name}`);
      return handler(params.input);
    }
    case 'deactivate': {
      abortController.abort();
      activationDisposable?.dispose();
      registrations.dispose();
      await definition?.deactivate?.();
      return { disposed: true };
    }
    default:
      throw new Error(`Unknown host method: ${request.method}`);
  }
}

process.on('message', async (raw) => {
  const response = rpcResponseSchema.safeParse(raw);
  if (response.success) {
    const waiter = pending.get(response.data.id);
    if (waiter) {
      pending.delete(response.data.id);
      if (response.data.ok) waiter.resolve(response.data.result);
      else waiter.reject(new Error(response.data.error ?? 'Host request failed'));
    }
    return;
  }
  const parsed = rpcRequestSchema.safeParse(raw);
  if (!parsed.success) return;
  try {
    const result = await handle(parsed.data);
    send({ v: API_VERSION, kind: 'response', id: parsed.data.id, ok: true, result });
  } catch (error) {
    send({
      v: API_VERSION,
      kind: 'response',
      id: parsed.data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.on('disconnect', () => process.exit(0));
