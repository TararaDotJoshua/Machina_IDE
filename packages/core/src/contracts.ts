import { z } from 'zod';

export const API_VERSION = 1 as const;
export const APP_VERSION = '1.0.0-beta.1';

export const permissionSchema = z.enum([
  'project.read',
  'project.write',
  'ui.panels',
  'process.worker',
  'ai.tools',
  'viewport.selection',
]);
export type Permission = z.infer<typeof permissionSchema>;

const commandContributionSchema = z.object({
  id: z.string().min(3),
  title: z.string().min(1),
  category: z.string().optional(),
  keybinding: z.string().optional(),
  icon: z.string().optional(),
  enablement: z.string().optional(),
});

const workspaceContributionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  order: z.number().optional(),
});

const inspectorContributionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  itemTypes: z.array(z.string()),
  priority: z.number().default(0),
  properties: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'readonly']),
    }),
  ),
});

const treeTypeSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  contextValue: z.string().optional(),
  stateKey: z.string().optional(),
});

const menuSchema = z.object({
  command: z.string(),
  when: z.string().optional(),
  group: z.string().optional(),
});

const panelSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['measurements', 'simulation', 'json', 'text']),
});

const toolbarSchema = z.object({ command: z.string(), location: z.literal('viewport') });

const capabilitySchema = z.object({
  name: z.string(),
  role: z.enum(['provider', 'consumer']),
});

const aiToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  sideEffects: z.array(z.enum(['write', 'process', 'network'])).default([]),
});

const workerSchema = z.object({
  id: z.string(),
  entry: z.string(),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  resultItemType: z.string().optional(),
});

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]+$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  engines: z.object({ mechatronicsIDE: z.string().min(1) }),
  main: z.string().optional(),
  renderer: z.string().optional(),
  activationEvents: z.array(
    z.string().refine(
      (value) =>
        value === 'onStartupFinished' ||
        /^(onWorkspace|onCommand|onProjectItem|onCapability):[^:]+$/.test(value),
      'Invalid activation event',
    ),
  ),
  permissions: z.array(permissionSchema).default([]),
  contributes: z
    .object({
      commands: z.array(commandContributionSchema).default([]),
      workspaces: z.array(workspaceContributionSchema).default([]),
      inspectorSections: z.array(inspectorContributionSchema).default([]),
      projectItemTypes: z.array(treeTypeSchema).default([]),
      explorerContextMenus: z.array(menuSchema).default([]),
      bottomPanels: z.array(panelSchema).default([]),
      toolbarActions: z.array(toolbarSchema).default([]),
      capabilities: z.array(capabilitySchema).default([]),
      aiTools: z.array(aiToolSchema).default([]),
      workers: z.array(workerSchema).default([]),
    })
    .default({
      commands: [],
      workspaces: [],
      inspectorSections: [],
      projectItemTypes: [],
      explorerContextMenus: [],
      bottomPanels: [],
      toolbarActions: [],
      capabilities: [],
      aiTools: [],
      workers: [],
    }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type CommandContribution = z.infer<typeof commandContributionSchema>;
export type InspectorContribution = z.infer<typeof inspectorContributionSchema>;
export type AiToolContribution = z.infer<typeof aiToolSchema>;

export const projectItemSchema: z.ZodType<ProjectItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).default({}),
    children: z.array(projectItemSchema).default([]),
  }),
);

export interface ProjectItem {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  children: ProjectItem[];
}

export const projectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  activeConfiguration: z.string(),
  treeItems: z.array(projectItemSchema),
  pluginState: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

export type PluginStatus = 'disabled' | 'ready' | 'active' | 'failed' | 'invalid';
export interface PluginDiagnostic {
  level: 'error' | 'warning';
  message: string;
}
export interface PluginDescriptor {
  manifest?: PluginManifest;
  id: string;
  name: string;
  path: string;
  source: 'bundled' | 'user';
  enabled: boolean;
  status: PluginStatus;
  diagnostics: PluginDiagnostic[];
}

export interface OutputEntry {
  id: string;
  timestamp: string;
  source: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface WorkerState {
  id: string;
  pluginId: string;
  workerId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: string;
  exitCode?: number | null;
}

export interface AppSnapshot {
  project: ProjectDocument | null;
  projectPath: string | null;
  plugins: PluginDescriptor[];
  contributions: Array<{ pluginId: string; contributes: PluginManifest['contributes'] }>;
  output: OutputEntry[];
  workers: WorkerState[];
}

export const rpcRequestSchema = z.object({
  v: z.literal(API_VERSION),
  kind: z.literal('request'),
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export const rpcResponseSchema = z.object({
  v: z.literal(API_VERSION),
  kind: z.literal('response'),
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export const rpcEventSchema = z.object({
  v: z.literal(API_VERSION),
  kind: z.literal('event'),
  event: z.string(),
  data: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
export type RpcEvent = z.infer<typeof rpcEventSchema>;

export type Unsubscribe = () => void;
export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
  checkedAt?: string;
}
export interface MachinaBridge {
  app: {
    getSnapshot(): Promise<AppSnapshot>;
    subscribe(listener: (snapshot: AppSnapshot) => void): Unsubscribe;
    subscribeMenu(listener: (action: string) => void): Unsubscribe;
  };
  project: {
    create(): Promise<ProjectDocument | null>;
    open(): Promise<ProjectDocument | null>;
    save(): Promise<void>;
    updateItem(itemId: string, patch: Record<string, unknown>): Promise<ProjectDocument>;
  };
  plugins: {
    setEnabled(pluginId: string, enabled: boolean): Promise<void>;
    reload(): Promise<void>;
    activateEvent(event: string): Promise<void>;
  };
  commands: { execute(commandId: string, args?: unknown): Promise<unknown> };
  workers: { cancel(instanceId: string): Promise<void> };
  ai: { invoke(pluginId: string, toolName: string, input: unknown): Promise<unknown> };
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: UpdateState) => void): Unsubscribe;
  };
}
