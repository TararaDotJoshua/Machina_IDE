import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
      treeItems: [
        {
          id: 'assembly-root',
          type: 'core.assembly',
          name: 'Main Assembly',
          properties: { status: 'draft', visible: true },
          children: [],
        },
      ],
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
      if (!item) throw new Error(`Project item not found: ${itemId}`);
      if (typeof patch.name === 'string') item.name = patch.name;
      item.properties = { ...item.properties, ...patch };
      delete item.properties.name;
    });
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
