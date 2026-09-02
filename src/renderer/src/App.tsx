import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Box,
  Boxes,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircuitBoard,
  Code2,
  Command,
  Folder,
  Gauge,
  GitBranch,
  GripVertical,
  LayoutGrid,
  Maximize2,
  Minimize2,
  MousePointer2,
  Package,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  Radio,
  RefreshCw,
  Ruler,
  Save,
  Search,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type { AppSnapshot, CommandContribution, ProjectItem } from '@mechatronics-ide/core';
import { Viewport } from './Viewport';
import { findProjectItem, getVirtualItems, useIdeStore, type VirtualItem } from './store';

type CommandItem = CommandContribution & { pluginId?: string; handler?: () => unknown };
type WorkspacePresetId = 'system' | 'mechanical' | 'electrical' | 'software';
type TileMode = 'floating' | 'grid' | 'rows' | 'columns' | 'cascade';
type DockZone = 'left' | 'right' | 'top' | 'bottom' | 'center';
type WorkspaceWindowId = 'project' | 'viewer' | 'electrical' | 'software' | 'console' | 'inspector' | 'extensions';
interface WindowRect { x: number; y: number; width: number; height: number; z: number }
interface DockCandidate { target: WorkspaceWindowId; zone: DockZone }
interface WorkspacePreset { id: WorkspacePresetId; title: string; storeWorkspace: string; windows: Partial<Record<WorkspaceWindowId, Omit<WindowRect, 'z'>>> }

const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: 'system', title: 'System', storeWorkspace: 'project', windows: {
    project: { x: 0, y: 0, width: 22, height: 70 }, viewer: { x: 22.4, y: 0, width: 55.2, height: 70 }, inspector: { x: 78, y: 0, width: 22, height: 70 }, console: { x: 0, y: 70.4, width: 100, height: 29.6 },
  } },
  { id: 'mechanical', title: 'Mechanical', storeWorkspace: 'design', windows: {
    project: { x: 0, y: 0, width: 20, height: 70 }, viewer: { x: 20.4, y: 0, width: 55.2, height: 70 }, inspector: { x: 76, y: 0, width: 24, height: 70 }, console: { x: 0, y: 70.4, width: 100, height: 29.6 },
  } },
  { id: 'electrical', title: 'Electrical', storeWorkspace: 'electronics', windows: {
    project: { x: 0, y: 0, width: 19, height: 100 }, electrical: { x: 19.4, y: 0, width: 57, height: 68 }, inspector: { x: 76.8, y: 0, width: 23.2, height: 68 }, console: { x: 19.4, y: 68.4, width: 80.6, height: 31.6 },
  } },
  { id: 'software', title: 'Software', storeWorkspace: 'software', windows: {
    project: { x: 0, y: 0, width: 19, height: 100 }, software: { x: 19.4, y: 0, width: 57, height: 70 }, inspector: { x: 76.8, y: 0, width: 23.2, height: 70 }, console: { x: 19.4, y: 70.4, width: 80.6, height: 29.6 },
  } },
];

const ALL_WINDOWS: WorkspaceWindowId[] = ['project', 'viewer', 'electrical', 'software', 'console', 'inspector', 'extensions'];

export function App(): React.JSX.Element {
  const { snapshot, setSnapshot, paletteOpen, setPaletteOpen, notification, notify } = useIdeStore();
  const [presetId, setPresetId] = useState<WorkspacePresetId>('system');
  const [windowRects, setWindowRects] = useState<Partial<Record<WorkspaceWindowId, WindowRect>>>(() => createPresetRects('system'));
  const [hiddenWindows, setHiddenWindows] = useState<Set<WorkspaceWindowId>>(() => hiddenForPreset('system'));
  const [activeWindow, setActiveWindow] = useState<WorkspaceWindowId>('viewer');
  const [maximizedWindow, setMaximizedWindow] = useState<WorkspaceWindowId | null>(null);
  const [tileMode, setTileMode] = useState<TileMode>('floating');
  const [windowOrder, setWindowOrder] = useState<WorkspaceWindowId[]>(() => presetWindowOrder('system'));
  const [dockPreview, setDockPreview] = useState<DockCandidate | null>(null);
  const zCounter = useRef(20);

  const applyPreset = useCallback((nextId: WorkspacePresetId) => {
    const preset = WORKSPACE_PRESETS.find((item) => item.id === nextId)!;
    setPresetId(nextId);
    setWindowRects(createPresetRects(nextId));
    setHiddenWindows(hiddenForPreset(nextId));
    setTileMode('floating');
    setWindowOrder(presetWindowOrder(nextId));
    setMaximizedWindow(null);
    const first = Object.keys(preset.windows)[0] as WorkspaceWindowId;
    setActiveWindow(first);
    useIdeStore.getState().setWorkspace(preset.storeWorkspace);
    const projectItems = flattenProjectItems(useIdeStore.getState().snapshot?.project?.treeItems ?? []);
    const selection = nextId === 'electrical'
      ? projectItems.find((item) => item.type.includes('electronics'))
      : nextId === 'software'
        ? projectItems.find((item) => item.type.includes('software'))
        : projectItems[0];
    if (selection) useIdeStore.getState().select(selection.id);
    void window.machina.plugins.activateEvent(`onWorkspace:${preset.storeWorkspace}`);
  }, []);

  const applyTileMode = useCallback((mode: TileMode) => {
    setTileMode(mode);
    setMaximizedWindow(null);
    if (mode === 'floating') return;
    setWindowRects((current) => tileWindowRects(current, windowOrder.filter((id) => !hiddenWindows.has(id)), mode));
  }, [hiddenWindows, windowOrder]);

  useEffect(() => {
    void window.machina.app.getSnapshot().then(setSnapshot);
    const unsubscribe = window.machina.app.subscribe(setSnapshot);
    const unsubscribeMenu = window.machina.app.subscribeMenu((action) => {
      if (action === 'commandPalette') setPaletteOpen(true);
      if (action.startsWith('workspace:')) applyPreset(action.slice('workspace:'.length) as WorkspacePresetId);
      if (action.startsWith('tiling:')) applyTileMode(action.slice('tiling:'.length) as TileMode);
      if (action.startsWith('window:')) {
        const id = action.slice('window:'.length) as WorkspaceWindowId;
        setHiddenWindows((current) => {
          const next = new Set(current);
          next.delete(id);
          if (tileMode !== 'floating') setWindowRects((rects) => tileWindowRects(rects, windowOrder.filter((windowId) => !next.has(windowId)), tileMode));
          return next;
        });
        setActiveWindow(id);
        zCounter.current += 1;
        setWindowRects((current) => ({ ...current, [id]: { ...(current[id] ?? { x: 18, y: 16, width: 46, height: 44, z: 1 }), z: zCounter.current } }));
      }
    });
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', keydown);
    return () => { unsubscribe(); unsubscribeMenu(); window.removeEventListener('keydown', keydown); };
  }, [applyPreset, applyTileMode, setPaletteOpen, setSnapshot, tileMode, windowOrder]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === '`' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setMaximizedWindow((current) => current === activeWindow ? null : activeWindow);
      }
      if (event.key === 'Escape' && maximizedWindow) setMaximizedWindow(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeWindow, maximizedWindow]);

  const commands = useCommands();
  if (!snapshot) return <div className="loading"><Gauge className="spin" /> Initializing engineering workspace…</div>;

  const toggleWindow = (id: WorkspaceWindowId) => {
    setHiddenWindows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (tileMode !== 'floating') setWindowRects((rects) => tileWindowRects(rects, windowOrder.filter((windowId) => !next.has(windowId)), tileMode));
      return next;
    });
    if (maximizedWindow === id) setMaximizedWindow(null);
  };
  const activateWindow = (id: WorkspaceWindowId) => {
    setActiveWindow(id);
    zCounter.current += 1;
    setWindowRects((current) => ({ ...current, [id]: current[id] ? { ...current[id]!, z: zCounter.current } : undefined }));
  };
  const updateWindowRect = (id: WorkspaceWindowId, rect: WindowRect) => {
    setTileMode('floating');
    setWindowRects((current) => ({ ...current, [id]: rect }));
  };
  const previewDock = (source: WorkspaceWindowId, clientX: number, clientY: number): DockCandidate | null => {
    const candidates = [...document.querySelectorAll<HTMLElement>('.workspace-window')]
      .filter((element) => element.dataset.windowId !== source && !hiddenWindows.has(element.dataset.windowId as WorkspaceWindowId))
      .map((element) => ({ id: element.dataset.windowId as WorkspaceWindowId, rect: element.getBoundingClientRect(), z: Number(element.style.zIndex || 0) }))
      .filter(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom)
      .sort((a, b) => b.z - a.z);
    const match = candidates[0];
    if (!match) { setDockPreview(null); return null; }
    const relativeX = (clientX - match.rect.left) / match.rect.width;
    const relativeY = (clientY - match.rect.top) / match.rect.height;
    const edge = 0.27;
    const zone: DockZone = relativeX < edge ? 'left' : relativeX > 1 - edge ? 'right' : relativeY < edge ? 'top' : relativeY > 1 - edge ? 'bottom' : 'center';
    const candidate = { target: match.id, zone };
    setDockPreview(candidate);
    return candidate;
  };
  const commitDock = (source: WorkspaceWindowId, candidate: DockCandidate, originalRect: WindowRect) => {
    setTileMode('floating');
    setMaximizedWindow(null);
    setActiveWindow(source);
    setWindowOrder((current) => reorderWindowIds(current, source, candidate.target, candidate.zone));
    setWindowRects((current) => smartDockRects(current, source, candidate.target, candidate.zone, originalRect));
    setDockPreview(null);
  };

  return (
    <div className="ide-shell">
      <TitleBar commands={commands} presetId={presetId} tileMode={tileMode} windows={ALL_WINDOWS} hiddenWindows={hiddenWindows} onTile={applyTileMode} onToggleWindow={toggleWindow} onResetLayout={() => applyPreset(presetId)} />
      <div className="main-row">
        <div className={`workspace-window-canvas tiling-${tileMode}`}>
          {(Object.entries(windowRects) as Array<[WorkspaceWindowId, WindowRect]>).filter(([id]) => !hiddenWindows.has(id)).map(([id, rect]) => <WorkspaceWindow key={id} id={id} rect={rect} active={activeWindow === id} maximized={maximizedWindow === id} dockZone={dockPreview?.target === id ? dockPreview.zone : null} onActivate={activateWindow} onRectChange={updateWindowRect} onDockPreview={previewDock} onDockCommit={commitDock} onDockCancel={() => setDockPreview(null)} onMaximize={(windowId) => setMaximizedWindow((current) => current === windowId ? null : windowId)} onHide={toggleWindow}><WorkspaceWindowContent id={id} commands={commands} /></WorkspaceWindow>)}
          {(Object.keys(windowRects) as WorkspaceWindowId[]).every((id) => hiddenWindows.has(id)) && <div className="empty-dock"><LayoutGrid size={30} /><strong>No windows are visible</strong><span>Use Layout to restore this workspace preset.</span><button onClick={() => applyPreset(presetId)}>Reset workspace</button></div>}
        </div>
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette commands={commands} />}
      {notification && <div className="toast"><Sparkles size={15} />{notification}<button onClick={() => notify(null)}><X size={14} /></button></div>}
    </div>
  );
}

function WorkspaceWindow({ id, rect, active, maximized, dockZone, children, onActivate, onRectChange, onDockPreview, onDockCommit, onDockCancel, onMaximize, onHide }: { id: WorkspaceWindowId; rect: WindowRect; active: boolean; maximized: boolean; dockZone: DockZone | null; children: React.ReactNode; onActivate(id: WorkspaceWindowId): void; onRectChange(id: WorkspaceWindowId, rect: WindowRect): void; onDockPreview(source: WorkspaceWindowId, clientX: number, clientY: number): DockCandidate | null; onDockCommit(source: WorkspaceWindowId, candidate: DockCandidate, originalRect: WindowRect): void; onDockCancel(): void; onMaximize(id: WorkspaceWindowId): void; onHide(id: WorkspaceWindowId): void }): React.JSX.Element {
  const meta = workspaceWindowMeta(id);
  const beginMove = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const canvas = event.currentTarget.closest('.workspace-window-canvas')?.getBoundingClientRect();
    if (!canvas || maximized) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, rect };
    let candidate: DockCandidate | null = null;
    const move = (moveEvent: PointerEvent) => {
      candidate = onDockPreview(id, moveEvent.clientX, moveEvent.clientY);
      if (!candidate) onRectChange(id, { ...rect, x: clamp(start.rect.x + ((moveEvent.clientX - start.x) / canvas.width) * 100, 0, 100 - rect.width), y: clamp(start.rect.y + ((moveEvent.clientY - start.y) / canvas.height) * 100, 0, 100 - rect.height) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (candidate) onDockCommit(id, candidate, start.rect); else onDockCancel(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const beginResize = (event: React.PointerEvent<HTMLDivElement>, direction: 'x' | 'y' | 'both') => {
    event.stopPropagation();
    const canvas = event.currentTarget.closest('.workspace-window-canvas')?.getBoundingClientRect();
    if (!canvas || maximized) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, rect };
    const move = (moveEvent: PointerEvent) => onRectChange(id, {
      ...rect,
      width: direction === 'y' ? rect.width : clamp(start.rect.width + ((moveEvent.clientX - start.x) / canvas.width) * 100, 14, 100 - rect.x),
      height: direction === 'x' ? rect.height : clamp(start.rect.height + ((moveEvent.clientY - start.y) / canvas.height) * 100, 16, 100 - rect.y),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const style: React.CSSProperties = maximized ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 1000 } : { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%`, zIndex: rect.z };
  return (
    <section className={`workspace-window ${active ? 'active' : ''} ${maximized ? 'maximized' : ''}`} data-window-id={id} style={style} onPointerDown={() => onActivate(id)}>
      <header className="dock-panel-header" onPointerDown={beginMove} onDoubleClick={() => onMaximize(id)}>
        <GripVertical size={12} className="dock-grip" />
        <button className="dock-tab active" title={`${meta.title} window`}>{meta.icon}<span>{meta.title}</span>{meta.plugin && <em>PLUGIN</em>}</button>
        <div className="dock-panel-spacer" />
        <button className="dock-panel-action" title={maximized ? `Restore ${meta.title}` : `Maximize ${meta.title}`} aria-label={maximized ? `Restore ${meta.title}` : `Maximize ${meta.title}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMaximize(id); }}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className="dock-panel-action" title={`Close ${meta.title}`} aria-label={`Close ${meta.title}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onHide(id); }}><X size={13} /></button>
      </header>
      <div className="dock-panel-content">{children}</div>
      {dockZone && <div className={`dock-drop-preview ${dockZone}`}><span>{dockZone === 'center' ? 'Swap panels' : `Dock ${dockZone}`}</span></div>}
      {!maximized && <><div className="window-resize-edge east" onPointerDown={(event) => beginResize(event, 'x')} /><div className="window-resize-edge south" onPointerDown={(event) => beginResize(event, 'y')} /><div className="window-resize-edge corner" onPointerDown={(event) => beginResize(event, 'both')} /></>}
    </section>
  );
}

function WorkspaceWindowContent({ id, commands }: { id: WorkspaceWindowId; commands: CommandItem[] }): React.JSX.Element {
  if (id === 'project') return <Explorer />;
  if (id === 'viewer') return <WorkArea commands={commands} />;
  if (id === 'electrical') return <ElectronicsWorkspace />;
  if (id === 'software') return <SoftwareWorkspace />;
  if (id === 'console') return <BottomPanel />;
  if (id === 'inspector') return <Inspector />;
  return <ExtensionDetails />;
}

function useCommands(): CommandItem[] {
  const snapshot = useIdeStore((state) => state.snapshot);
  const notify = useIdeStore((state) => state.notify);
  const setPaletteOpen = useIdeStore((state) => state.setPaletteOpen);
  const report = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      const result = await action();
      if (result !== null && result !== undefined) notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const core: CommandItem[] = [
    { id: 'core.project.create', title: 'Create Project…', category: 'Project', handler: () => report(() => window.machina.project.create(), 'Project created') },
    { id: 'core.project.open', title: 'Open Project…', category: 'Project', handler: () => report(() => window.machina.project.open(), 'Project opened') },
    { id: 'core.project.save', title: 'Save Project', category: 'Project', keybinding: 'Ctrl+S', handler: () => snapshot?.project ? report(() => window.machina.project.save(), 'Project saved') : notify('No project is open') },
    { id: 'core.plugins.reload', title: 'Reload Extensions', category: 'Developer', handler: () => report(() => window.machina.plugins.reload(), 'Extensions reloaded') },
    { id: 'core.palette', title: 'Show Command Palette', category: 'View', keybinding: 'Ctrl+Shift+P', handler: () => setPaletteOpen(true) },
  ];
  const contributed = (snapshot?.contributions ?? []).flatMap(({ pluginId, contributes }) =>
    contributes.commands.map((command) => ({ ...command, pluginId })),
  );
  return [...core, ...contributed].map((command): CommandItem => ({
    ...command,
    handler: ('handler' in command ? command.handler : undefined) ?? (async () => {
      try {
        const result = await window.machina.commands.execute(command.id);
        notify(typeof result === 'string' ? result : `${command.title} completed`);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
      }
    }),
  }));
}

function TitleBar({ commands, presetId, tileMode, windows, hiddenWindows, onTile, onToggleWindow, onResetLayout }: { commands: CommandItem[]; presetId: WorkspacePresetId; tileMode: TileMode; windows: WorkspaceWindowId[]; hiddenWindows: Set<WorkspaceWindowId>; onTile(mode: TileMode): void; onToggleWindow(id: WorkspaceWindowId): void; onResetLayout(): void }): React.JSX.Element {
  const setPaletteOpen = useIdeStore((state) => state.setPaletteOpen);
  const hasProject = useIdeStore((state) => Boolean(state.snapshot?.project));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const tileOptions: Array<{ id: TileMode; title: string; icon: React.ReactNode }> = [
    { id: 'grid', title: 'Tile as grid', icon: <LayoutGrid size={13} /> },
    { id: 'rows', title: 'Tile in rows', icon: <PanelBottom size={13} /> },
    { id: 'columns', title: 'Tile in columns', icon: <PanelLeft size={13} /> },
    { id: 'cascade', title: 'Cascade windows', icon: <Boxes size={13} /> },
    { id: 'floating', title: 'Freeform', icon: <MousePointer2 size={13} /> },
  ];
  return (
    <header className="titlebar">
      <div className="brand"><strong>Machina</strong><span>IDE</span></div>
      <button className="palette-trigger" onClick={() => setPaletteOpen(true)}><Search size={14} /><span>Search commands</span><kbd>Ctrl ⇧ P</kbd></button>
      <div className="layout-menu-wrap"><button className={`layout-trigger ${layoutOpen ? 'active' : ''}`} onClick={() => setLayoutOpen((open) => !open)}><LayoutGrid size={15} /><span>Windows</span><ChevronDown size={12} /></button>{layoutOpen && <div className="layout-menu" onMouseLeave={() => setLayoutOpen(false)}><small>TILING</small>{tileOptions.map((option) => <button key={option.id} onClick={() => onTile(option.id)}>{option.icon}<span>{option.title}</span><em className={tileMode === option.id ? 'visible' : ''}>{tileMode === option.id ? 'Active' : ''}</em></button>)}<div /><small>ALL WINDOWS</small>{windows.map((id) => { const meta = workspaceWindowMeta(id); const visible = !hiddenWindows.has(id); return <button key={id} onClick={() => onToggleWindow(id)}>{meta.icon}<span>{meta.title}</span><em className={visible ? 'visible' : ''}>{visible ? 'Shown' : 'Hidden'}</em></button>; })}<div /><button onClick={() => { onResetLayout(); setLayoutOpen(false); }}><RefreshCw size={13} /><span>Reset {WORKSPACE_PRESETS.find((preset) => preset.id === presetId)?.title}</span></button></div>}</div>
      <button className="icon-button" title={hasProject ? 'Save project' : 'No project to save'} disabled={!hasProject} onClick={() => void commands.find((item) => item.id === 'core.project.save')?.handler?.()}><Save size={16} /></button>
    </header>
  );
}

function Explorer(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot)!;
  const workspace = useIdeStore((state) => state.workspace);
  const [filter, setFilter] = useState('');
  const notify = useIdeStore((state) => state.notify);
  const runProjectAction = (action: () => Promise<unknown>, success: string) => void action().then((result) => { if (result !== null && result !== undefined) notify(success); }).catch((error) => notify(error instanceof Error ? error.message : String(error)));
  if (workspace === 'extensions') return <Extensions />;
  const virtual = getVirtualItems(snapshot);
  const items = projectItemsForWorkspace(snapshot.project?.treeItems ?? [], virtual, workspace);
  return (
    <div className="pane-content">
      <PaneHeader title={workspace === 'project' ? 'PROJECT' : workspace.toUpperCase()} />
      <div className="explorer-search"><Search size={13} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter project" /></div>
      <div className="section-heading"><ChevronDown size={13} /><span>{workspaceProjectionTitle(workspace, snapshot.project?.name ?? 'No project')}</span></div>
      <div className="tree" role="tree">
        {items.filter((item) => treeMatchesFilter(item, filter)).map((item) => <TreeNode key={item.id} item={item} depth={0} />)}
        {items.length === 0 && <div className="tree-empty">No items in this engineering view.</div>}
      </div>
      <div className="explorer-footer"><button onClick={() => runProjectAction(() => window.machina.project.create(), 'Project created')}><Plus size={13} /> New Project</button><button onClick={() => runProjectAction(() => window.machina.project.open(), 'Project opened')}><Folder size={13} /> Open</button></div>
    </div>
  );
}

function TreeNode({ item, depth }: { item: ProjectItem | VirtualItem; depth: number }): React.JSX.Element {
  const expanded = useIdeStore((state) => state.expanded.has(item.id));
  const toggle = useIdeStore((state) => state.toggleExpanded);
  const selected = useIdeStore((state) => state.selectedId === item.id);
  const select = useIdeStore((state) => state.select);
  const hasChildren = item.children.length > 0;
  const icon = projectItemIcon(item.type, 14);
  const status = String(item.properties.status ?? (item.type.includes('result') ? 'complete' : ''));
  const selectItem = () => {
    select(item.id);
    void window.machina.plugins.activateEvent(`onProjectItem:${item.type}`);
  };
  return (
    <div>
      <div className={`tree-row ${selected ? 'selected' : ''}`} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined} tabIndex={selected ? 0 : -1} style={{ paddingLeft: 8 + depth * 15 }} onClick={selectItem} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectItem(); }} onDoubleClick={() => hasChildren && toggle(item.id)}>
        <button className="tree-chevron" title={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} ${item.name}` : undefined} aria-label={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} ${item.name}` : undefined} onClick={(event) => { event.stopPropagation(); if (hasChildren) toggle(item.id); }}>{hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}</button>
        {icon}<span className="tree-label">{item.name}</span>{status && <span className={`tree-status ${status}`} title={`Status: ${status}`}><span />{status}</span>}
      </div>
      {expanded && item.children.map((child) => <TreeNode key={child.id} item={child} depth={depth + 1} />)}
    </div>
  );
}

function Extensions(): React.JSX.Element {
  const plugins = useIdeStore((state) => state.snapshot?.plugins ?? []);
  const [query, setQuery] = useState('');
  const filtered = plugins.filter((plugin) => `${plugin.name} ${plugin.id} ${plugin.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="pane-content extensions-list">
      <PaneHeader title="EXTENSIONS" action={<button title="Reload" onClick={() => void window.machina.plugins.reload()}><RefreshCw size={14} /></button>} />
      <div className="explorer-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed" /></div>
      {plugins.length === 0 && <div className="empty-state"><Package size={28} /><strong>No extensions installed</strong><span>Open the user extensions folder from the Developer menu.</span></div>}
      {plugins.length > 0 && filtered.length === 0 && <div className="empty-state"><Search size={28} /><strong>No matching extensions</strong><span>Try a different search.</span></div>}
      {filtered.map((plugin) => <div className={`extension-card ${plugin.status}`} key={`${plugin.source}-${plugin.id}`}><div className="extension-icon"><Package size={19} /></div><div className="extension-copy"><strong>{plugin.name}</strong><span>{plugin.manifest?.version ?? 'Invalid manifest'} · {plugin.source}</span><small>{plugin.status}</small>{plugin.diagnostics.map((item, index) => <em key={index}>{item.message}</em>)}</div><label className="switch"><input type="checkbox" checked={plugin.enabled} disabled={plugin.status === 'invalid'} onChange={(event) => void window.machina.plugins.setEnabled(plugin.id, event.target.checked)} /><span /></label></div>)}
    </div>
  );
}

function WorkArea({ commands }: { commands: CommandItem[] }): React.JSX.Element {
  const workspace = useIdeStore((state) => state.workspace);
  const selectedId = useIdeStore((state) => state.selectedId);
  const notify = useIdeStore((state) => state.notify);
  const contributions = useIdeStore((state) => state.snapshot?.contributions ?? []);
  const [renderMode, setRenderMode] = useState<'shaded' | 'wireframe'>('shaded');
  const [frameToken, setFrameToken] = useState(0);
  if (workspace === 'extensions') return <ExtensionDetails />;
  const toolbar = contributions.flatMap((item) => item.contributes.toolbarActions).map((action) => commands.find((command) => command.id === action.command)).filter(Boolean) as CommandItem[];
  if (workspace === 'electronics') return <ElectronicsWorkspace />;
  if (workspace === 'software') return <SoftwareWorkspace />;
  return (
    <section className="work-area">
      <EditorTabs icon={<Box size={13} />} title={workspace === 'design' ? 'Mechanical Assembly' : 'System Model'} />
      <div className="viewport-toolbar"><div><button className="active" title="Selection mode"><MousePointer2 size={15} /></button><button title="Frame model" onClick={() => setFrameToken((value) => value + 1)}><Maximize2 size={15} /></button></div><div className="toolbar-center"><button className={renderMode === 'shaded' ? 'active' : ''} onClick={() => setRenderMode('shaded')}>Shaded</button><button className={renderMode === 'wireframe' ? 'active' : ''} onClick={() => setRenderMode('wireframe')}>Wireframe</button>{toolbar.map((command) => <button key={command.id} className="plugin-toolbar" onClick={() => void window.machina.commands.execute(command.id, { target: selectedId }).then((result) => notify(String(result)))}><Sparkles size={13} />{command.title}</button>)}</div></div>
      <Viewport key={frameToken} renderMode={renderMode} />
      <div className="workspace-context"><strong>{workspace === 'design' ? 'Mechanical design' : 'System overview'}</strong><span>Select a component to connect the tree, viewport, inspector, and engineering panels.</span></div>
    </section>
  );
}

function EditorTabs({ icon, title }: { icon: React.ReactNode; title: string }): React.JSX.Element {
  return <div className="editor-tabs"><div className="editor-tab-label">{icon}<span>{title}</span></div></div>;
}

function ElectronicsWorkspace(): React.JSX.Element {
  const select = useIdeStore((state) => state.select);
  const project = useIdeStore((state) => state.snapshot?.project);
  const root = project?.treeItems.find((item) => item.type.includes('electronics'));
  if (!root) return <section className="work-area domain-workspace"><EditorTabs icon={<CircuitBoard size={13} />} title="Electrical Systems" /><div className="domain-empty"><CircuitBoard size={34} /><strong>No electrical system configured</strong><span>This project does not contain any electrical items.</span></div></section>;
  return (
    <section className="work-area domain-workspace">
      <EditorTabs icon={<CircuitBoard size={13} />} title={root.name} />
      <div className="domain-toolbar"><div><strong>{root.name}</strong><span>{formatPropertyValue(root.properties.voltage ?? 'Voltage not set')} · {formatPropertyValue(root.properties.bus ?? 'Bus not set')}</span></div></div>
      <div className="schematic-canvas">
        <div className="schematic-summary"><span><CircuitBoard size={14} /> {root.children.length} devices</span><span><Zap size={14} /> {formatPropertyValue(root.properties.voltage ?? '—')}</span><span><Radio size={14} /> {formatPropertyValue(root.properties.bus ?? '—')}</span></div>
        {root.children.map((item, index) => <button key={item.id} className="schematic-node" style={{ left: `${10 + (index % 3) * 31}%`, top: `${36 + Math.floor(index / 3) * 28}%` }} onClick={() => select(item.id)}>{projectItemIcon(item.type, 21)}<strong>{item.name}</strong><span>{summarizeProperties(item.properties)}</span><em>{item.type.replace('core.', '').toUpperCase()}</em></button>)}
        {root.children.length === 0 && <div className="domain-empty"><CircuitBoard size={30} /><strong>No electrical devices</strong><span>Add electrical items to the project document to populate this view.</span></div>}
      </div>
    </section>
  );
}

function SoftwareWorkspace(): React.JSX.Element {
  const select = useIdeStore((state) => state.select);
  const project = useIdeStore((state) => state.snapshot?.project);
  const root = project?.treeItems.find((item) => item.type.includes('software'));
  if (!root) return <section className="work-area domain-workspace"><EditorTabs icon={<Code2 size={13} />} title="Firmware" /><div className="domain-empty"><Code2 size={34} /><strong>No firmware target configured</strong><span>This project does not contain firmware metadata or source modules.</span></div></section>;
  return (
    <section className="work-area domain-workspace">
      <EditorTabs icon={<Code2 size={13} />} title={root.name} />
      <div className="domain-toolbar"><div><strong>{root.name}</strong><span>{formatPropertyValue(root.properties.target ?? 'Target not set')} · {formatPropertyValue(root.properties.configuration ?? 'Configuration not set')}</span></div></div>
      <div className="software-canvas">
        <aside className="software-outline"><small>MODULES</small><button onClick={() => select(root.id)}><Braces size={13} /> {root.name}</button>{root.children.map((item) => <button key={item.id} onClick={() => select(item.id)}><Code2 size={13} /> {item.name}</button>)}</aside>
        <div className="firmware-details"><Code2 size={32} /><strong>{root.children.length ? `${root.children.length} source module${root.children.length === 1 ? '' : 's'}` : 'No source modules registered'}</strong><span>Machina displays project firmware metadata here. Building requires a configured toolchain integration.</span><div className="metadata-grid">{Object.entries(root.properties).map(([key, value]) => <div key={key}><small>{titleCase(key)}</small><b>{formatPropertyValue(value)}</b></div>)}</div></div>
      </div>
    </section>
  );
}

function ExtensionDetails(): React.JSX.Element {
  const plugins = useIdeStore((state) => state.snapshot?.plugins ?? []);
  return <section className="work-area extension-details"><div className="hero"><Package size={44} /><div><p>EXTENSION HOST</p><h1>Installed extensions</h1><span>User extensions are validated and isolated from the renderer.</span></div></div>{plugins.length === 0 ? <div className="domain-empty"><Package size={34} /><strong>No extensions installed</strong><span>Use Developer → Open User Plugins Folder to add an extension, then reload extensions.</span></div> : <div className="extension-grid">{plugins.map((plugin) => <article key={`${plugin.source}-${plugin.id}`}><div><Package size={21} /><strong>{plugin.name}</strong><span className={`status-pill ${plugin.status}`}>{plugin.status}</span></div><p>{plugin.id}</p><small>Permissions</small><div className="chips">{plugin.manifest?.permissions.map((permission) => <span key={permission}>{permission}</span>) ?? <span>Manifest rejected</span>}</div><small>Activation events</small><div className="mono-list">{plugin.manifest?.activationEvents.join('\n') ?? plugin.diagnostics.map((item) => item.message).join('\n')}</div></article>)}</div>}</section>;
}

function Inspector(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot)!;
  const selectedId = useIdeStore((state) => state.selectedId);
  const virtual = getVirtualItems(snapshot);
  const item = findProjectItem(snapshot.project?.treeItems ?? [], selectedId) ?? virtual.find((entry) => entry.id === selectedId);
  const sections = snapshot.contributions.flatMap((entry) => entry.contributes.inspectorSections.map((section) => ({ ...section, pluginId: entry.pluginId }))).filter((section) => item && section.itemTypes.includes(item.type)).sort((a, b) => b.priority - a.priority);
  if (!item) return <div className="pane-content"><PaneHeader title="INSPECTOR" /><div className="empty-state"><MousePointer2 size={28} /><span>Select a project item</span></div></div>;
  const engineeringStatus = String(item.properties.status ?? (item.type.includes('result') ? 'complete' : 'ready'));
  const coreProperties = Object.fromEntries(Object.entries(item.properties).filter(([key]) => !['id', 'name', 'status'].includes(key)).map(([key, value]) => [titleCase(key), key === 'completedAt' ? formatDateTime(String(value)) : formatPropertyValue(value)]));
  return (
    <div className="pane-content inspector">
      <PaneHeader title="INSPECTOR" />
      <div className="selection-heading"><div className="selection-icon">{projectItemIcon(item.type, 20)}</div><div><strong>{item.name}</strong><span>{item.type}</span><div className={`selection-status ${engineeringStatus}`}><span />{engineeringStatus}</div></div></div>
      <PropertySection title="Engineering status" properties={{ State: engineeringStatus, Owner: item.type.startsWith('core.') ? 'Machina Core' : 'Plugin contribution', Configuration: snapshot.project?.activeConfiguration ?? 'Default' }} />
      {Object.keys(coreProperties).length > 0 && <PropertySection title={inspectorSectionTitle(item.type)} properties={coreProperties} />}
      {sections.map((section) => <PropertySection key={`${section.pluginId}-${section.id}`} title={section.title} plugin={section.pluginId} properties={Object.fromEntries(section.properties.map((property) => [property.label, resolveInspectorValue(snapshot, item, section.pluginId, property.key)]))} />)}
    </div>
  );
}

function PropertySection({ title, properties, plugin }: { title: string; properties: Record<string, string>; plugin?: string }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return <section className="property-section"><button className="property-heading" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{title}</strong>{plugin && <span>PLUGIN</span>}</button>{open && <div className="property-grid">{Object.entries(properties).map(([key, value]) => <div className="property-row" key={key}><label>{key}</label><div>{value}</div></div>)}</div>}</section>;
}

function BottomPanel(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot)!;
  const tab = useIdeStore((state) => state.bottomTab);
  const setTab = useIdeStore((state) => state.setBottomTab);
  const problems = snapshot.plugins.flatMap((plugin) => plugin.diagnostics.map((diagnostic) => ({ ...diagnostic, source: plugin.name })));
  const tabs = [{ id: 'problems', title: 'Problems', count: problems.length }, { id: 'output', title: 'Output' }];
  return (
    <div className="bottom-inner">
      <div className="bottom-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.title}{'count' in item && item.count ? <span>{item.count}</span> : null}</button>)}</div>
      <div className="panel-body">{tab === 'problems' ? <ProblemsView problems={problems} /> : <OutputView />}</div>
    </div>
  );
}

function OutputView(): React.JSX.Element {
  const output = useIdeStore((state) => state.snapshot?.output ?? []);
  const workers = useIdeStore((state) => state.snapshot?.workers ?? []);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView(), [output.length]);
  return <div className="output-view"><div className="output-tools"><strong>Activity log</strong>{workers.filter((worker) => worker.status === 'running').map((worker) => <button key={worker.id} className="cancel-worker" onClick={() => void window.machina.workers.cancel(worker.id)}><Square size={11} /> Cancel {worker.workerId}</button>)}</div><div className="log-lines">{output.length === 0 ? <div className="empty-inline"><CheckCircle2 size={17} /> No activity has been recorded.</div> : output.map((entry) => <div key={entry.id} className={entry.level}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><strong>[{entry.source}]</strong><span>{entry.message}</span></div>)}<div ref={end} /></div></div>;
}

function ProblemsView({ problems }: { problems: Array<{ source: string; level: string; message: string }> }): React.JSX.Element {
  return <div className="problems-view">{problems.length === 0 ? <div className="empty-inline"><CheckCircle2 size={18} /> No problems detected</div> : problems.map((problem, index) => <div className={`problem-row ${problem.level}`} key={index}><CircleAlert size={15} /><strong>{problem.source}</strong><span>{humanizeDiagnostic(problem.message)}</span><em>{problem.level}</em></div>)}</div>;
}

function CommandPalette({ commands }: { commands: CommandItem[] }): React.JSX.Element {
  const close = useIdeStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => commands.filter((command) => `${command.category} ${command.title} ${command.id}`.toLowerCase().includes(query.toLowerCase())), [commands, query]);
  const invoke = (command?: CommandItem) => { if (!command) return; close(false); void command.handler?.(); };
  return <div className="palette-scrim" onMouseDown={() => close(false)}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}><div className="palette-input"><Command size={17} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') setActive((value) => Math.min(value + 1, filtered.length - 1)); if (event.key === 'ArrowUp') setActive((value) => Math.max(value - 1, 0)); if (event.key === 'Enter') invoke(filtered[active]); }} placeholder="Type a command or search…" /><kbd>ESC</kbd></div><div className="palette-label">{query ? 'MATCHING COMMANDS' : 'RECENT & AVAILABLE'}</div><div className="palette-results">{filtered.map((command, index) => <button key={command.id} className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => invoke(command)}><div className="command-icon">{command.pluginId ? <Package size={15} /> : <Command size={15} />}</div><div><strong>{command.title}</strong><span>{command.category ?? 'Plugin'} · {command.id}</span></div>{command.pluginId && <em>PLUGIN</em>}{command.keybinding && <kbd>{command.keybinding}</kbd>}</button>)}</div><div className="palette-footer"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Run</span><span>{filtered.length} commands</span></div></div></div>;
}

function StatusBar(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot);
  const running = snapshot?.workers.filter((worker) => worker.status === 'running').length ?? 0;
  const project = snapshot?.project;
  return <footer className="status-bar"><div><span className="status-ready" /> {project ? 'Ready' : 'No project open'}</div>{project && <div><Box size={12} /> {project.activeConfiguration}</div>}<div className="status-spacer" /><div>{running ? <><span className="pulse" /> {running} task running</> : 'No active tasks'}</div>{project && <div>Saved {formatDateTime(project.updatedAt)}</div>}<div>Machina 0.2.0-beta.1</div></footer>;
}

function PaneHeader({ title, action }: { title: string; action?: React.ReactNode }): React.JSX.Element { return <div className="pane-header"><span>{title}</span>{action && <div>{action}</div>}</div>; }

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function titleCase(value: string): string { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
function flattenProjectItems(items: ProjectItem[]): ProjectItem[] { return items.flatMap((item) => [item, ...flattenProjectItems(item.children)]); }
function summarizeProperties(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties).filter(([key]) => key !== 'status').slice(0, 2);
  return entries.length ? entries.map(([key, value]) => `${titleCase(key)}: ${formatPropertyValue(value)}`).join(' · ') : 'No properties';
}

function createPresetRects(id: WorkspacePresetId): Partial<Record<WorkspaceWindowId, WindowRect>> {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  return Object.fromEntries(ALL_WINDOWS.map((windowId, index) => {
    const presetRect = preset.windows[windowId];
    const fallback = { x: 8 + (index % 5) * 4, y: 7 + (index % 4) * 4, width: 46, height: 44 };
    return [windowId, { ...(presetRect ?? fallback), z: index + 1 }];
  })) as Partial<Record<WorkspaceWindowId, WindowRect>>;
}

function hiddenForPreset(id: WorkspacePresetId): Set<WorkspaceWindowId> {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  return new Set(ALL_WINDOWS.filter((windowId) => !preset.windows[windowId]));
}

function presetWindowOrder(id: WorkspacePresetId): WorkspaceWindowId[] {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  const visible = Object.keys(preset.windows) as WorkspaceWindowId[];
  return [...visible, ...ALL_WINDOWS.filter((windowId) => !visible.includes(windowId))];
}

function reorderWindowIds(order: WorkspaceWindowId[], source: WorkspaceWindowId, target: WorkspaceWindowId, zone: DockZone): WorkspaceWindowId[] {
  const next = order.filter((id) => id !== source);
  const targetIndex = next.indexOf(target);
  const insertAfter = zone === 'right' || zone === 'bottom';
  next.splice(Math.max(0, targetIndex + (insertAfter ? 1 : 0)), 0, source);
  return next;
}

function smartDockRects(current: Partial<Record<WorkspaceWindowId, WindowRect>>, source: WorkspaceWindowId, target: WorkspaceWindowId, zone: DockZone, originalSource: WindowRect): Partial<Record<WorkspaceWindowId, WindowRect>> {
  const targetRect = current[target];
  if (!targetRect) return current;
  const next = { ...current };
  const gap = 0.4;
  const sameRow = Math.abs(originalSource.y - targetRect.y) < 2 && Math.abs(originalSource.height - targetRect.height) < 2;
  const sameColumn = Math.abs(originalSource.x - targetRect.x) < 2 && Math.abs(originalSource.width - targetRect.width) < 2;
  if ((zone === 'left' || zone === 'right') && sameRow) {
    const x = Math.min(originalSource.x, targetRect.x);
    const width = Math.max(originalSource.x + originalSource.width, targetRect.x + targetRect.width) - x;
    const half = (width - gap) / 2;
    const leftRect = { x, y: targetRect.y, width: half, height: targetRect.height };
    const rightRect = { x: x + half + gap, y: targetRect.y, width: half, height: targetRect.height };
    next[source] = { ...(zone === 'left' ? leftRect : rightRect), z: Math.max(originalSource.z, targetRect.z) + 1 };
    next[target] = { ...(zone === 'left' ? rightRect : leftRect), z: targetRect.z };
    return next;
  }
  if ((zone === 'top' || zone === 'bottom') && sameColumn) {
    const y = Math.min(originalSource.y, targetRect.y);
    const height = Math.max(originalSource.y + originalSource.height, targetRect.y + targetRect.height) - y;
    const half = (height - gap) / 2;
    const topRect = { x: targetRect.x, y, width: targetRect.width, height: half };
    const bottomRect = { x: targetRect.x, y: y + half + gap, width: targetRect.width, height: half };
    next[source] = { ...(zone === 'top' ? topRect : bottomRect), z: Math.max(originalSource.z, targetRect.z) + 1 };
    next[target] = { ...(zone === 'top' ? bottomRect : topRect), z: targetRect.z };
    return next;
  }
  next[source] = { ...targetRect, z: Math.max(originalSource.z, targetRect.z) + 1 };
  next[target] = { ...originalSource, z: targetRect.z };
  return next;
}

function tileWindowRects(current: Partial<Record<WorkspaceWindowId, WindowRect>>, ids: WorkspaceWindowId[], mode: Exclude<TileMode, 'floating'>): Partial<Record<WorkspaceWindowId, WindowRect>> {
  if (ids.length === 0) return current;
  const next = { ...current };
  const gap = 0.4;
  if (mode === 'cascade') {
    const width = 64;
    const height = 62;
    const stepX = ids.length === 1 ? 0 : (100 - width) / (ids.length - 1);
    const stepY = ids.length === 1 ? 0 : (100 - height) / (ids.length - 1);
    ids.forEach((id, index) => { next[id] = { x: index * stepX, y: index * stepY, width, height, z: index + 1 }; });
    return next;
  }
  const columns = mode === 'columns' ? ids.length : mode === 'rows' ? 1 : Math.ceil(Math.sqrt(ids.length));
  const rows = mode === 'rows' ? ids.length : mode === 'columns' ? 1 : Math.ceil(ids.length / columns);
  const width = (100 - gap * (columns - 1)) / columns;
  const height = (100 - gap * (rows - 1)) / rows;
  ids.forEach((id, index) => {
    const column = mode === 'rows' ? 0 : index % columns;
    const row = mode === 'columns' ? 0 : Math.floor(index / columns);
    next[id] = { x: column * (width + gap), y: row * (height + gap), width, height, z: index + 1 };
  });
  return next;
}

function workspaceWindowMeta(id: WorkspaceWindowId): { title: string; icon: React.ReactNode; plugin?: boolean } {
  const meta: Record<WorkspaceWindowId, { title: string; icon: React.ReactNode; plugin?: boolean }> = {
    project: { title: 'Project', icon: <PanelLeft size={13} /> },
    viewer: { title: 'System Model', icon: <LayoutGrid size={13} /> },
    electrical: { title: 'Electrical Systems', icon: <CircuitBoard size={13} /> },
    software: { title: 'Firmware Editor', icon: <Code2 size={13} /> },
    console: { title: 'Console', icon: <PanelBottom size={13} /> },
    inspector: { title: 'Inspector', icon: <PanelRight size={13} /> },
    extensions: { title: 'Extension Host', icon: <Package size={13} /> },
  };
  return meta[id];
}

function projectItemsForWorkspace(items: ProjectItem[], virtual: VirtualItem[], workspace: string): Array<ProjectItem | VirtualItem> {
  if (workspace === 'project') return [...items, ...virtual];
  if (workspace === 'design') return items.filter((item) => item.type === 'core.assembly');
  if (workspace === 'electronics') return items.filter((item) => item.type.includes('electronics'));
  if (workspace === 'software') return items.filter((item) => item.type.includes('software'));
  return [...items, ...virtual];
}

function workspaceProjectionTitle(workspace: string, projectName: string): string {
  if (workspace === 'project') return projectName.toUpperCase();
  const labels: Record<string, string> = { design: 'MECHANICAL STRUCTURE', electronics: 'ELECTRICAL SYSTEM', software: 'FIRMWARE TARGETS' };
  return labels[workspace] ?? projectName.toUpperCase();
}

function treeMatchesFilter(item: ProjectItem | VirtualItem, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return item.name.toLowerCase().includes(query) || item.type.toLowerCase().includes(query) || item.children.some((child) => treeMatchesFilter(child, query));
}

function projectItemIcon(type: string, size: number): React.ReactNode {
  if (type.includes('measurement')) return <Ruler size={size} />;
  if (type.includes('result')) return <Activity size={size} />;
  if (type.includes('motor')) return <Gauge size={size} />;
  if (type.includes('joint')) return <GitBranch size={size} />;
  if (type.includes('sensor')) return <Radio size={size} />;
  if (type.includes('bus')) return <Zap size={size} />;
  if (type.includes('electronics') || type.includes('controller')) return <CircuitBoard size={size} />;
  if (type.includes('software')) return <Braces size={size} />;
  if (type.includes('assembly')) return <Boxes size={size} />;
  return <Box size={size} />;
}

function inspectorSectionTitle(type: string): string {
  if (type.includes('electronics') || type.includes('controller') || type.includes('sensor') || type.includes('bus')) return 'Electrical';
  if (type.includes('software')) return 'Firmware';
  if (type.includes('result')) return 'Simulation result';
  if (type.includes('measurement')) return 'Measurement record';
  return 'Properties';
}

function formatPropertyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(' · ');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${titleCase(key)}: ${String(entry)}`).join(' · ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function resolveInspectorValue(snapshot: AppSnapshot, item: ProjectItem | VirtualItem, pluginId: string, key: string): string {
  if (key in item.properties) return formatPropertyValue(item.properties[key]);
  const state = snapshot.project?.pluginState[pluginId] as Record<string, unknown> | undefined;
  if (state && key in state) return formatPropertyValue(state[key]);
  return '—';
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function humanizeDiagnostic(message: string): string {
  return message.replace(/Invalid string: must match pattern \/[^/]+\//g, 'Does not match the required format').replace('Invalid option: expected one of ', 'Unsupported permission. Allowed: ');
}
