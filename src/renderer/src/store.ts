import { create } from 'zustand';
import type { AppSnapshot, ProjectItem } from '@mechatronics-ide/core';

interface UiState {
  snapshot: AppSnapshot | null;
  workspace: string;
  selectedId: string | null;
  expanded: Set<string>;
  bottomTab: string;
  paletteOpen: boolean;
  notification: string | null;
  setSnapshot(snapshot: AppSnapshot): void;
  setWorkspace(workspace: string): void;
  select(id: string): void;
  toggleExpanded(id: string): void;
  setBottomTab(tab: string): void;
  setPaletteOpen(open: boolean): void;
  notify(message: string | null): void;
}

export const useIdeStore = create<UiState>((set) => ({
  snapshot: null,
  workspace: 'project',
  selectedId: 'assembly-root',
  expanded: new Set(['assembly-root']),
  bottomTab: 'output',
  paletteOpen: false,
  notification: null,
  setSnapshot: (snapshot) => set((state) => {
    const selectedId = findProjectItem(snapshot.project?.treeItems ?? [], state.selectedId)
      ? state.selectedId
      : snapshot.project?.treeItems[0]?.id ?? null;
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
        items.push({
          id: String(record.id ?? `${contribution.pluginId}-${items.length}`),
          name: String(record.name ?? type.label),
          type: type.type,
          properties: record,
          children: [],
          pluginId: contribution.pluginId,
        });
      }
    }
  }
  return items;
}
