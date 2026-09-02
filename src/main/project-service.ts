import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectDocumentSchema, type ProjectDocument, type ProjectItem } from '@mechatronics-ide/core';

export class ProjectService extends EventEmitter {
  private document: ProjectDocument | null = null;
  private projectRoot: string | null = null;
  private undoStack: ProjectDocument[] = [];

  get current(): ProjectDocument | null {
    return this.document ? structuredClone(this.document) : null;
  }

  get path(): string | null {
    return this.projectRoot;
  }

  async createAt(root: string, name: string): Promise<ProjectDocument> {
    await mkdir(join(root, 'assets'), { recursive: true });
    const now = new Date().toISOString();
    this.document = {
      schemaVersion: 1,
      id: randomUUID(),
      name,
      activeConfiguration: 'Default',
      updatedAt: now,
      treeItems: [],
      treePlacements: {},
      pluginState: {},
    };
    this.projectRoot = root;
    this.undoStack = [];
    await this.save();
    this.emit('change', this.current);
    return this.current!;
  }

  async load(root: string): Promise<ProjectDocument> {
    const file = root.toLowerCase().endsWith('.json') ? root : join(root, 'project.json');
    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
    this.document = this.migrate(raw);
    this.projectRoot = dirname(file);
    this.undoStack = [];
    this.emit('change', this.current);
    return this.current!;
  }

  async save(): Promise<void> {
    if (!this.document || !this.projectRoot) throw new Error('No project is open');
    this.document.updatedAt = new Date().toISOString();
    await mkdir(this.projectRoot, { recursive: true });
    const file = join(this.projectRoot, 'project.json');
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  }

  async transaction(label: string, mutate: (draft: ProjectDocument) => void): Promise<ProjectDocument> {
    if (!this.document) throw new Error('No project is open');
    const before = structuredClone(this.document);
    const draft = structuredClone(this.document);
    mutate(draft);
    this.document = projectDocumentSchema.parse(draft);
    this.undoStack.push(before);
    await this.save();
    this.emit('change', this.current, label);
    return this.current!;
  }

  async undo(): Promise<ProjectDocument | null> {
    const previous = this.undoStack.pop();
    if (!previous) return this.current;
    this.document = previous;
    await this.save();
    this.emit('change', this.current, 'Undo');
    return this.current;
  }

  getPluginState(pluginId: string): unknown {
    if (!this.document) throw new Error('No project is open');
    return structuredClone(this.document.pluginState[pluginId]);
  }

  async setPluginState(pluginId: string, state: unknown): Promise<void> {
    await this.transaction(`Update ${pluginId} state`, (draft) => {
      draft.pluginState[pluginId] = state;
    });
  }

  async updateItem(itemId: string, patch: Record<string, unknown>): Promise<ProjectDocument> {
    return this.transaction(`Update ${itemId}`, (draft) => {
      const item = findItem(draft.treeItems, itemId);
      const pluginItem = item ? undefined : findPluginRecord(draft.pluginState, itemId);
      if (!item && !pluginItem) throw new Error(`Project item not found: ${itemId}`);
      const values = validateItemPatch(patch);
      if (item) {
        if (typeof values.name === 'string') item.name = values.name;
        item.properties = { ...item.properties, ...values };
        delete item.properties.name;
      } else if (pluginItem) {
        Object.assign(pluginItem, values);
      }
    });
  }

  async createFolder(parentId: string | null = null): Promise<ProjectDocument> {
    return this.transaction('Create project folder', (draft) => {
      if (parentId && findItem(draft.treeItems, parentId)?.type !== 'core.folder') throw new Error('Folders can only be created at the project root or inside another folder');
      const id = randomUUID();
      draft.treeItems.push({ id, type: 'core.folder', name: 'New Folder', properties: {}, children: [] });
      draft.treePlacements[id] = { parentId, order: nextOrder(draft, parentId) };
    });
  }

  async moveItem(itemId: string, parentId: string | null, order: number): Promise<ProjectDocument> {
    return this.transaction(`Move ${itemId}`, (draft) => {
      if (!findItem(draft.treeItems, itemId) && !findPluginRecord(draft.pluginState, itemId)) throw new Error(`Project item not found: ${itemId}`);
      if (parentId && findItem(draft.treeItems, parentId)?.type !== 'core.folder') throw new Error('Project items can only be placed inside folders');
      if (itemId === parentId || createsPlacementCycle(draft, itemId, parentId)) throw new Error('A folder cannot be moved inside itself');
      draft.treePlacements[itemId] = { parentId, order: Math.max(0, Math.trunc(order)) };
    });
  }

  async reorderItems(parentId: string | null, itemIds: string[]): Promise<ProjectDocument> {
    return this.transaction('Reorder project tree', (draft) => {
      if (itemIds.length > 10_000 || new Set(itemIds).size !== itemIds.length) throw new Error('Invalid project tree order');
      if (parentId && findItem(draft.treeItems, parentId)?.type !== 'core.folder') throw new Error('Project items can only be placed inside folders');
      itemIds.forEach((itemId, order) => {
        if (!findItem(draft.treeItems, itemId) && !findPluginRecord(draft.pluginState, itemId)) throw new Error(`Project item not found: ${itemId}`);
        if (itemId === parentId || createsPlacementCycle(draft, itemId, parentId)) throw new Error('A folder cannot be moved inside itself');
        draft.treePlacements[itemId] = { parentId, order };
      });
    });
  }

  async readAsset(relativePath: string): Promise<unknown> {
    if (!this.projectRoot) throw new Error('No project is open');
    const assetsRoot = resolve(this.projectRoot, 'assets');
    const candidate = resolve(this.projectRoot, relativePath);
    const childPath = relative(assetsRoot, candidate);
    if (!childPath || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
      throw new Error('Asset path must stay inside the project assets directory');
    }
    const info = await stat(candidate);
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new Error('Project asset is unavailable or too large');
    return JSON.parse(await readFile(candidate, 'utf8')) as unknown;
  }

  private migrate(raw: unknown): ProjectDocument {
    // Versioned migration switch intentionally starts small; unknown pluginState is never interpreted.
    return projectDocumentSchema.parse(raw);
  }
}

function findItem(items: ProjectItem[], id: string): ProjectItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = findItem(item.children, id);
    if (nested) return nested;
  }
  return undefined;
}

function findPluginRecord(pluginState: Record<string, unknown>, id: string): Record<string, unknown> | undefined {
  const visit = (value: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(value)) {
      for (const entry of value) { const found = visit(entry); if (found) return found; }
      return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (record.id === id) return record;
    for (const entry of Object.values(record)) { const found = visit(entry); if (found) return found; }
    return undefined;
  };
  return visit(pluginState);
}

function validateItemPatch(patch: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const entries = Object.entries(patch);
  if (entries.length === 0 || entries.length > 25) throw new Error('Invalid property update');
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || ['id', 'type', 'assetPath', 'importedAt'].includes(key)) throw new Error(`Property cannot be edited: ${key}`);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null) throw new Error(`Property value must be text, a number, or a boolean: ${key}`);
    if (typeof value === 'string' && (value.length > 2_000 || (key === 'name' && !value.trim()))) throw new Error(`Invalid value for ${key}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid number for ${key}`);
    result[key] = typeof value === 'string' && key === 'name' ? value.trim() : value;
  }
  return result;
}

function nextOrder(document: ProjectDocument, parentId: string | null): number {
  return Math.max(-1, ...Object.values(document.treePlacements).filter((entry) => entry.parentId === parentId).map((entry) => entry.order)) + 1;
}

function createsPlacementCycle(document: ProjectDocument, itemId: string, parentId: string | null): boolean {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === itemId || seen.has(current)) return true;
    seen.add(current);
    current = document.treePlacements[current]?.parentId ?? null;
  }
  return false;
}
