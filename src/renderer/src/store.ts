import { create } from 'zustand';
import type { AppSnapshot, ProjectItem, UpdateState } from '@mechatronics-ide/core';

interface UiState {
  snapshot: AppSnapshot | null;
  workspace: string;
  selectedId: string | null;
  expanded: Set<string>;
  bottomTab: string;
  paletteOpen: boolean;
  notification: string | null;
  updateState: UpdateState;
  setSnapshot(snapshot: AppSnapshot): void;
  setWorkspace(workspace: string): void;
  select(id: string): void;
  toggleExpanded(id: string): void;
  setBottomTab(tab: string): void;
  setPaletteOpen(open: boolean): void;
  notify(message: string | null): void;
  setUpdateState(updateState: UpdateState): void;
}

export const useIdeStore = create<UiState>((set) => ({
  snapshot: null,
  workspace: 'project',
  selectedId: 'assembly-root',
  expanded: new Set(['assembly-root']),
  bottomTab: 'output',
  paletteOpen: false,
  notification: null,
  updateState: { status: 'disabled', currentVersion: '0.0.0' },
  setSnapshot: (snapshot) => set((state) => {
    const selectedId = findProjectItem(getProjectTree(snapshot), state.selectedId)
      ? state.selectedId
      : getProjectTree(snapshot)[0]?.id ?? null;
    const expanded = new Set(state.expanded);
    if (snapshot.project?.treeItems[0]) expanded.add(snapshot.project.treeItems[0].id);
    return { snapshot, selectedId, expanded };
  }),
  setWorkspace: (workspace) => set({ workspace }),
  select: (selectedId) => set({ selectedId }),
  toggleExpanded: (id) =>
    set((state) => {
      const expanded = new Set(state.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return { expanded };
    }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  notify: (notification) => set({ notification }),
  setUpdateState: (updateState) => set({ updateState }),
}));

export function findProjectItem(items: ProjectItem[], id: string | null): ProjectItem | undefined {
  if (!id) return undefined;
  for (const item of items) {
    if (item.id === id) return item;
    const nested = findProjectItem(item.children, id);
    if (nested) return nested;
  }
  return undefined;
}

export interface VirtualItem extends ProjectItem {
  pluginId: string;
}

export function getVirtualItems(snapshot: AppSnapshot | null): VirtualItem[] {
  if (!snapshot?.project) return [];
  const items: VirtualItem[] = [];
  for (const contribution of snapshot.contributions) {
    for (const type of contribution.contributes.projectItemTypes) {
      if (!type.stateKey) continue;
      const state = snapshot.project.pluginState[contribution.pluginId] as Record<string, unknown> | undefined;
      const values = state?.[type.stateKey];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        const bodies = Array.isArray(record.bodies) ? record.bodies : [];
        items.push({
          id: String(record.id ?? `${contribution.pluginId}-${items.length}`),
          name: String(record.name ?? type.label),
          type: type.type,
          properties: record,
          children: bodies.filter((body): body is Record<string, unknown> => Boolean(body && typeof body === 'object')).map((body, bodyIndex) => ({
            id: String(body.id ?? `${String(record.id)}:body:${bodyIndex}`),
            name: String(body.name ?? `Body ${bodyIndex + 1}`),
            type: String(body.type ?? 'dev.machina.step.body'),
            properties: body,
            children: [],
            pluginId: contribution.pluginId,
          })),
          pluginId: contribution.pluginId,
        });
      }
    }
  }
  return items;
}

export function getProjectTree(snapshot: AppSnapshot | null): Array<ProjectItem | VirtualItem> {
  if (!snapshot?.project) return [];
  const source = [...snapshot.project.treeItems, ...getVirtualItems(snapshot)];
  const nodes = new Map<string, { item: ProjectItem | VirtualItem; baseParent: string | null; baseOrder: number }>();
  const collect = (items: Array<ProjectItem | VirtualItem>, parentId: string | null) => {
    items.forEach((item, index) => {
      nodes.set(item.id, { item: { ...item, children: [] }, baseParent: parentId, baseOrder: index });
      collect(item.children as Array<ProjectItem | VirtualItem>, item.id);
    });
  };
  collect(source, null);
  const roots: Array<ProjectItem | VirtualItem> = [];
  const children = new Map<string, Array<ProjectItem | VirtualItem>>();
  const parentFor = (id: string, baseParent: string | null): string | null => {
    const requested = snapshot.project!.treePlacements[id]?.parentId;
    const parent = requested === undefined ? baseParent : requested;
    if (!parent || parent === id || !nodes.has(parent)) return null;
    const seen = new Set([id]);
    let cursor: string | null = parent;
    while (cursor) {
      if (seen.has(cursor)) return null;
      seen.add(cursor);
      const record = nodes.get(cursor);
      cursor = record ? (snapshot.project!.treePlacements[cursor]?.parentId ?? record.baseParent) : null;
    }
    return parent;
  };
  for (const [id, record] of nodes) {
    const parent = parentFor(id, record.baseParent);
    if (!parent) roots.push(record.item);
    else {
      const list = children.get(parent) ?? [];
      list.push(record.item);
      children.set(parent, list);
    }
  }
  const order = (item: ProjectItem | VirtualItem) => snapshot.project!.treePlacements[item.id]?.order ?? nodes.get(item.id)?.baseOrder ?? 0;
  const attach = (items: Array<ProjectItem | VirtualItem>): Array<ProjectItem | VirtualItem> => items.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map((item) => ({ ...item, children: attach(children.get(item.id) ?? []) }));
  return attach(roots);
}
