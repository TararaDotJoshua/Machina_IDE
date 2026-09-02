import type { Disposable, Permission } from '@mechatronics-ide/core';

export interface ScopedLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WorkerHandle {
  id: string;
  result<T>(): Promise<T>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly permissions: ReadonlySet<Permission>;
  readonly signal: AbortSignal;
  readonly logger: ScopedLogger;
  commands: {
    registerCommand(id: string, handler: (args?: unknown) => unknown | Promise<unknown>): Disposable;
  };
  ai: {
    registerTool(name: string, handler: (input: unknown) => unknown | Promise<unknown>): Disposable;
  };
  project: {
    getState<T>(): Promise<T | undefined>;
    setState<T>(state: T): Promise<void>;
    getRoot(): Promise<string | null>;
    readAsset<T>(relativePath: string): Promise<T>;
  };
  files: {
    open(options: { title?: string; extensions: string[] }): Promise<string | null>;
  };
  workers: {
    start(workerId: string, args?: unknown): Promise<WorkerHandle>;
  };
}

export interface PluginDefinition {
  activate(context: PluginContext): void | Disposable | Promise<void | Disposable>;
  deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: PluginDefinition): PluginDefinition {
  return plugin;
}
