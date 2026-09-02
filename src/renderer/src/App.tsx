import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  Boxes,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircuitBoard,
  Command,
  Folder,
  FolderPlus,
  Download,
  ExternalLink,
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
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Ruler,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { APP_VERSION, sceneAssetSchema, type AppSnapshot, type CommandContribution, type PluginLibraryEntry, type PluginLibraryState, type PluginWindowContribution, type ProjectItem, type SceneAsset, type UpdateState } from '@mechatronics-ide/core';
import { Viewport } from './Viewport';
import { findProjectItem, getProjectTree, useIdeStore, type VirtualItem } from './store';

type CommandItem = CommandContribution & { pluginId?: string; handler?: () => unknown };
type WorkspacePresetId = 'system' | 'mechanical' | 'electrical' | 'software';
type TileMode = 'floating' | 'grid' | 'rows' | 'columns' | 'cascade';
type DockZone = 'left' | 'right' | 'top' | 'bottom' | 'center';
type CoreWindowId = 'project' | 'viewer' | 'console' | 'inspector' | 'extensions';
type WorkspaceWindowId = string;
interface WindowRect { x: number; y: number; width: number; height: number; z: number }
interface DockCandidate { target: WorkspaceWindowId; zone: DockZone }
interface WorkspacePreset { id: WorkspacePresetId; title: string; storeWorkspace: string; windows: Partial<Record<WorkspaceWindowId, Omit<WindowRect, 'z'>>> }
interface PluginWindowDescriptor extends PluginWindowContribution { pluginId: string; runtimeId: string }
interface WindowMeta { title: string; icon: React.ReactNode; plugin?: boolean }
interface SystemSceneSource { id: string; assetPath: string; bodies: Array<{ meshIndex: number; visible: boolean }> }

const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: 'system', title: 'System', storeWorkspace: 'project', windows: {
    project: { x: 0, y: 0, width: 22, height: 70 }, viewer: { x: 22.4, y: 0, width: 55.2, height: 70 }, inspector: { x: 78, y: 0, width: 22, height: 70 }, console: { x: 0, y: 70.4, width: 100, height: 29.6 },
  } },
  { id: 'mechanical', title: 'Mechanical', storeWorkspace: 'design', windows: {
    project: { x: 0, y: 0, width: 20, height: 70 }, viewer: { x: 20.4, y: 0, width: 55.2, height: 70 }, inspector: { x: 76, y: 0, width: 24, height: 70 }, console: { x: 0, y: 70.4, width: 100, height: 29.6 },
  } },
  { id: 'electrical', title: 'Electrical', storeWorkspace: 'electronics', windows: {
    project: { x: 0, y: 0, width: 24, height: 100 }, viewer: { x: 24.4, y: 0, width: 51.6, height: 68 }, inspector: { x: 76.4, y: 0, width: 23.6, height: 68 }, console: { x: 24.4, y: 68.4, width: 75.6, height: 31.6 },
  } },
  { id: 'software', title: 'Software', storeWorkspace: 'software', windows: {
    project: { x: 0, y: 0, width: 24, height: 100 }, viewer: { x: 24.4, y: 0, width: 51.6, height: 70 }, inspector: { x: 76.4, y: 0, width: 23.6, height: 70 }, console: { x: 24.4, y: 70.4, width: 75.6, height: 29.6 },
  } },
];

const CORE_WINDOWS: CoreWindowId[] = ['project', 'viewer', 'console', 'inspector', 'extensions'];

export function App(): React.JSX.Element {
  const { snapshot, setSnapshot, paletteOpen, setPaletteOpen, notification, notify, updateState, setUpdateState } = useIdeStore();
  const pluginWindows = (snapshot?.contributions ?? []).flatMap((entry) => entry.contributes.windows.filter((window) => window.kind !== 'viewportScene').map((window) => ({ ...window, pluginId: entry.pluginId, runtimeId: `plugin:${entry.pluginId}:${window.id}` })));
  const allWindows = [...CORE_WINDOWS, ...pluginWindows.map((window) => window.runtimeId)];
  const [presetId, setPresetId] = useState<WorkspacePresetId>('system');
  const [windowRects, setWindowRects] = useState<Partial<Record<WorkspaceWindowId, WindowRect>>>(() => createPresetRects('system', []));
  const [hiddenWindows, setHiddenWindows] = useState<Set<WorkspaceWindowId>>(() => hiddenForPreset('system', []));
  const [activeWindow, setActiveWindow] = useState<WorkspaceWindowId>('viewer');
  const [maximizedWindow, setMaximizedWindow] = useState<WorkspaceWindowId | null>(null);
  const [tileMode, setTileMode] = useState<TileMode>('floating');
  const [windowOrder, setWindowOrder] = useState<WorkspaceWindowId[]>(() => presetWindowOrder('system', []));
  const [dockPreview, setDockPreview] = useState<DockCandidate | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
  const zCounter = useRef(20);
  const pluginWindowSignature = pluginWindows.map((window) => `${window.runtimeId}:${window.defaultWorkspaces.join(',')}`).join('|');
  const appliedPluginWindowSignature = useRef('');

  const applyPreset = useCallback((nextId: WorkspacePresetId) => {
    const preset = WORKSPACE_PRESETS.find((item) => item.id === nextId)!;
    setPresetId(nextId);
    setWindowRects(createPresetRects(nextId, pluginWindows));
    setHiddenWindows(hiddenForPreset(nextId, pluginWindows));
    setTileMode('floating');
    setWindowOrder(presetWindowOrder(nextId, pluginWindows));
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
  }, [pluginWindows]);

  useEffect(() => {
    if (pluginWindowSignature === appliedPluginWindowSignature.current) return;
    appliedPluginWindowSignature.current = pluginWindowSignature;
    applyPreset(presetId);
  }, [applyPreset, pluginWindowSignature, presetId]);

  const applyTileMode = useCallback((mode: TileMode) => {
    setTileMode(mode);
    setMaximizedWindow(null);
    if (mode === 'floating') return;
    setWindowRects((current) => tileWindowRects(current, windowOrder.filter((id) => !hiddenWindows.has(id)), mode));
  }, [hiddenWindows, windowOrder]);

  useEffect(() => {
    void window.machina.app.getSnapshot().then(setSnapshot);
    const unsubscribe = window.machina.app.subscribe(setSnapshot);
    void window.machina.updates.getState().then(setUpdateState);
    const unsubscribeUpdates = window.machina.updates.subscribe((state) => {
      setUpdateState(state);
      if (state.status === 'downloaded') setDismissedUpdate(null);
    });
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
    return () => { unsubscribe(); unsubscribeUpdates(); unsubscribeMenu(); window.removeEventListener('keydown', keydown); };
  }, [applyPreset, applyTileMode, setPaletteOpen, setSnapshot, setUpdateState, tileMode, windowOrder]);

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
      <TitleBar commands={commands} presetId={presetId} tileMode={tileMode} windows={allWindows} pluginWindows={pluginWindows} hiddenWindows={hiddenWindows} onTile={applyTileMode} onToggleWindow={toggleWindow} onResetLayout={() => applyPreset(presetId)} />
      <div className="main-row">
        <div className={`workspace-window-canvas tiling-${tileMode}`}>
          {allWindows.filter((id) => !hiddenWindows.has(id)).map((id, index) => { const rect = windowRects[id] ?? fallbackWindowRect(index); return <WorkspaceWindow key={id} id={id} meta={workspaceWindowMeta(id, pluginWindows)} rect={rect} active={activeWindow === id} maximized={maximizedWindow === id} dockZone={dockPreview?.target === id ? dockPreview.zone : null} onActivate={activateWindow} onRectChange={updateWindowRect} onDockPreview={previewDock} onDockCommit={commitDock} onDockCancel={() => setDockPreview(null)} onMaximize={(windowId) => setMaximizedWindow((current) => current === windowId ? null : windowId)} onHide={toggleWindow}><WindowErrorBoundary windowId={id}><WorkspaceWindowContent id={id} commands={commands} pluginWindows={pluginWindows} /></WindowErrorBoundary></WorkspaceWindow>; })}
          {allWindows.every((id) => hiddenWindows.has(id)) && <div className="empty-dock"><LayoutGrid size={30} /><strong>No windows are visible</strong><span>Use Layout to restore this workspace preset.</span><button onClick={() => applyPreset(presetId)}>Reset workspace</button></div>}
        </div>
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette commands={commands} />}
      {updateState.status === 'downloaded' && dismissedUpdate !== updateState.availableVersion && <UpdatePrompt state={updateState} onLater={() => setDismissedUpdate(updateState.availableVersion ?? 'downloaded')} />}
      {notification && <div className="toast"><Sparkles size={15} />{notification}<button onClick={() => notify(null)}><X size={14} /></button></div>}
    </div>
  );
}

class WindowErrorBoundary extends Component<{ windowId: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : 'This window encountered an unexpected error.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Window ${this.props.windowId} failed`, error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ windowId: string }>): void {
    if (previous.windowId !== this.props.windowId && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <div className="window-error"><CircleAlert size={28} /><strong>This window stopped responding</strong><span>{this.state.error}</span><button onClick={() => this.setState({ error: null })}>Try again</button></div>;
  }
}

function WorkspaceWindow({ id, meta, rect, active, maximized, dockZone, children, onActivate, onRectChange, onDockPreview, onDockCommit, onDockCancel, onMaximize, onHide }: { id: WorkspaceWindowId; meta: WindowMeta; rect: WindowRect; active: boolean; maximized: boolean; dockZone: DockZone | null; children: React.ReactNode; onActivate(id: WorkspaceWindowId): void; onRectChange(id: WorkspaceWindowId, rect: WindowRect): void; onDockPreview(source: WorkspaceWindowId, clientX: number, clientY: number): DockCandidate | null; onDockCommit(source: WorkspaceWindowId, candidate: DockCandidate, originalRect: WindowRect): void; onDockCancel(): void; onMaximize(id: WorkspaceWindowId): void; onHide(id: WorkspaceWindowId): void }): React.JSX.Element {
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

function WorkspaceWindowContent({ id, commands, pluginWindows }: { id: WorkspaceWindowId; commands: CommandItem[]; pluginWindows: PluginWindowDescriptor[] }): React.JSX.Element {
  if (id === 'project') return <Explorer />;
  if (id === 'viewer') return <WorkArea commands={commands} />;
  if (id === 'console') return <BottomPanel />;
  if (id === 'inspector') return <Inspector />;
  if (id === 'extensions') return <PluginLibrary />;
  const descriptor = pluginWindows.find((window) => window.runtimeId === id);
  return descriptor ? <PluginWindow descriptor={descriptor} /> : <div className="empty-state">Window unavailable</div>;
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
    { id: 'core.plugins.reload', title: 'Reload Plugins', category: 'Developer', handler: () => report(() => window.machina.plugins.reload(), 'Plugins reloaded') },
    { id: 'core.updates.check', title: 'Check for Updates', category: 'Help', handler: async () => { const state = await window.machina.updates.check(); notify(state.message ?? 'Update check complete'); } },
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

function TitleBar({ commands, presetId, tileMode, windows, pluginWindows, hiddenWindows, onTile, onToggleWindow, onResetLayout }: { commands: CommandItem[]; presetId: WorkspacePresetId; tileMode: TileMode; windows: WorkspaceWindowId[]; pluginWindows: PluginWindowDescriptor[]; hiddenWindows: Set<WorkspaceWindowId>; onTile(mode: TileMode): void; onToggleWindow(id: WorkspaceWindowId): void; onResetLayout(): void }): React.JSX.Element {
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
      <div className="layout-menu-wrap"><button className={`layout-trigger ${layoutOpen ? 'active' : ''}`} onClick={() => setLayoutOpen((open) => !open)}><LayoutGrid size={15} /><span>Windows</span><ChevronDown size={12} /></button>{layoutOpen && <div className="layout-menu" onMouseLeave={() => setLayoutOpen(false)}><small>TILING</small>{tileOptions.map((option) => <button key={option.id} onClick={() => onTile(option.id)}>{option.icon}<span>{option.title}</span><em className={tileMode === option.id ? 'visible' : ''}>{tileMode === option.id ? 'Active' : ''}</em></button>)}<div /><small>ALL WINDOWS</small>{windows.map((id) => { const meta = workspaceWindowMeta(id, pluginWindows); const visible = !hiddenWindows.has(id); return <button key={id} onClick={() => onToggleWindow(id)}>{meta.icon}<span>{meta.title}</span><em className={visible ? 'visible' : ''}>{visible ? 'Shown' : 'Hidden'}</em></button>; })}<div /><button onClick={() => { onResetLayout(); setLayoutOpen(false); }}><RefreshCw size={13} /><span>Reset {WORKSPACE_PRESETS.find((preset) => preset.id === presetId)?.title}</span></button></div>}</div>
      <button className="icon-button" title={hasProject ? 'Save project' : 'No project to save'} disabled={!hasProject} onClick={() => void commands.find((item) => item.id === 'core.project.save')?.handler?.()}><Save size={16} /></button>
    </header>
  );
}

function Explorer(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot)!;
  const workspace = useIdeStore((state) => state.workspace);
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ item: ProjectItem | VirtualItem; parentId: string | null; index: number; x: number; y: number } | null>(null);
  const notify = useIdeStore((state) => state.notify);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const runProjectAction = (action: () => Promise<unknown>, success: string) => void action().then((result) => { if (result !== null && result !== undefined) notify(success); }).catch((error) => notify(error instanceof Error ? error.message : String(error)));
  if (workspace === 'extensions') return <Extensions />;
  const fullTree = getProjectTree(snapshot);
  const items = projectItemsForWorkspace(fullTree, workspace);
  const folders = flattenProjectItems(fullTree).filter((item) => item.type === 'core.folder');
  const siblings = contextMenu ? (contextMenu.parentId ? findProjectItem(fullTree, contextMenu.parentId)?.children ?? [] : fullTree) : [];
  const reorder = async (parentId: string | null, ordered: Array<ProjectItem | VirtualItem>) => window.machina.project.reorderItems(parentId, ordered.map((item) => item.id));
  const moveRelative = (offset: number) => {
    if (!contextMenu) return;
    const next = [...siblings];
    const target = clamp(contextMenu.index + offset, 0, next.length - 1);
    const [item] = next.splice(contextMenu.index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    runProjectAction(() => reorder(contextMenu.parentId, next), `${item.name} reordered`);
    setContextMenu(null);
  };
  const moveToFolder = (folderId: string | null) => {
    if (!contextMenu) return;
    const destination = folderId ? findProjectItem(fullTree, folderId)?.children ?? [] : fullTree;
    runProjectAction(() => reorder(folderId, [...destination.filter((item) => item.id !== contextMenu.item.id), contextMenu.item]), `${contextMenu.item.name} moved`);
    setContextMenu(null);
  };
  return (
    <div className="pane-content" onClick={() => setContextMenu(null)}>
      <PaneHeader title={workspace === 'project' ? 'PROJECT' : workspace.toUpperCase()} action={<button title="New folder" onClick={(event) => { event.stopPropagation(); runProjectAction(() => window.machina.project.createFolder(null), 'Folder created'); }}><FolderPlus size={14} /></button>} />
      <div className="explorer-search"><Search size={13} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter project" /></div>
      <div className="section-heading"><ChevronDown size={13} /><span>{workspaceProjectionTitle(workspace, snapshot.project?.name ?? 'No project')}</span></div>
      <div className="tree" role="tree">
        {items.filter((item) => treeMatchesFilter(item, filter)).map((item, index) => <TreeNode key={item.id} item={item} depth={0} parentId={null} index={index} renamingId={renamingId} onBeginRename={setRenamingId} onContext={(value) => setContextMenu(value)} onDropItem={(sourceId, parentId, targetIndex) => { const destination = parentId ? findProjectItem(fullTree, parentId)?.children ?? [] : fullTree; const source = findProjectItem(fullTree, sourceId); if (!source) return; const next = destination.filter((entry) => entry.id !== sourceId); next.splice(clamp(targetIndex, 0, next.length), 0, source); runProjectAction(() => reorder(parentId, next), `${source.name} moved`); }} />)}
        {items.length === 0 && <div className="tree-empty">No items in this engineering view.</div>}
      </div>
      <div className="explorer-footer"><button onClick={() => runProjectAction(() => window.machina.project.create(), 'Project created')}><Plus size={13} /> New Project</button><button onClick={() => runProjectAction(() => window.machina.project.open(), 'Project opened')}><Folder size={13} /> Open</button></div>
      {contextMenu && <div className="tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => { setRenamingId(contextMenu.item.id); setContextMenu(null); }}><Pencil size={13} /> Rename <kbd>F2</kbd></button>
        {contextMenu.item.type === 'dev.machina.step.model' && <button onClick={() => { runProjectAction(() => window.machina.commands.execute('machina.step.breakIntoBodies', { target: contextMenu.item.id }), 'STEP model separated into bodies'); setContextMenu(null); }}><Boxes size={13} /> Separate into bodies</button>}
        {contextMenu.item.type === 'dev.machina.step.model' && <button className="danger" onClick={() => { const item = contextMenu.item; setContextMenu(null); if (window.confirm(`Delete STEP import “${item.name}”? This removes the model and its cached geometry from this project.`)) runProjectAction(() => window.machina.commands.execute('machina.step.deleteImport', { target: item.id }), `${item.name} deleted`); }}><Trash2 size={13} /> Delete STEP import</button>}
        <div />
        <button disabled={contextMenu.index === 0} onClick={() => moveRelative(-1)}><ArrowUp size={13} /> Move up</button>
        <button disabled={contextMenu.index >= siblings.length - 1} onClick={() => moveRelative(1)}><ArrowDown size={13} /> Move down</button>
        <button onClick={() => moveToFolder(null)}><Folder size={13} /> Move to project root</button>
        {folders.filter((folder) => folder.id !== contextMenu.item.id).map((folder) => <button key={folder.id} onClick={() => moveToFolder(folder.id)}><Folder size={13} /> Move to {folder.name}</button>)}
        <div />
        <button onClick={() => { runProjectAction(() => window.machina.project.createFolder(contextMenu.item.type === 'core.folder' ? contextMenu.item.id : contextMenu.parentId), 'Folder created'); setContextMenu(null); }}><FolderPlus size={13} /> New folder here</button>
      </div>}
    </div>
  );
}

function TreeNode({ item, depth, parentId, index, renamingId, onBeginRename, onContext, onDropItem }: { item: ProjectItem | VirtualItem; depth: number; parentId: string | null; index: number; renamingId: string | null; onBeginRename(id: string | null): void; onContext(value: { item: ProjectItem | VirtualItem; parentId: string | null; index: number; x: number; y: number }): void; onDropItem(sourceId: string, parentId: string | null, index: number): void }): React.JSX.Element {
  const expanded = useIdeStore((state) => state.expanded.has(item.id));
  const toggle = useIdeStore((state) => state.toggleExpanded);
  const selected = useIdeStore((state) => state.selectedId === item.id);
  const select = useIdeStore((state) => state.select);
  const hasChildren = item.children.length > 0;
  const icon = projectItemIcon(item.type, 14);
  const status = String(item.properties.status ?? (item.type.includes('result') ? 'complete' : ''));
  const [draftName, setDraftName] = useState(item.name);
  useEffect(() => setDraftName(item.name), [item.name, renamingId]);
  const commitRename = () => {
    const name = draftName.trim();
    onBeginRename(null);
    if (name && name !== item.name) void window.machina.project.updateItem(item.id, { name });
  };
  const selectItem = () => {
    select(item.id);
    void window.machina.plugins.activateEvent(`onProjectItem:${item.type}`);
  };
  return (
    <div>
      <div className={`tree-row ${selected ? 'selected' : ''}`} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined} tabIndex={selected ? 0 : -1} draggable={renamingId !== item.id} style={{ paddingLeft: 8 + depth * 15 }} onClick={selectItem} onContextMenu={(event) => { event.preventDefault(); selectItem(); onContext({ item, parentId, index, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); onBeginRename(item.id); } else if (event.key === 'Enter' || event.key === ' ') selectItem(); }} onDoubleClick={() => hasChildren || item.type === 'core.folder' ? toggle(item.id) : onBeginRename(item.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-machina-tree-item', item.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const sourceId = event.dataTransfer.getData('application/x-machina-tree-item'); if (!sourceId || sourceId === item.id) return; if (item.type === 'core.folder') onDropItem(sourceId, item.id, item.children.length); else onDropItem(sourceId, parentId, index); }}>
        <button className="tree-chevron" title={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} ${item.name}` : undefined} aria-label={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} ${item.name}` : undefined} onClick={(event) => { event.stopPropagation(); if (hasChildren) toggle(item.id); }}>{hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}</button>
        {icon}{renamingId === item.id ? <input className="tree-rename" autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onClick={(event) => event.stopPropagation()} onBlur={commitRename} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') onBeginRename(null); }} /> : <span className="tree-label">{item.name}</span>}{status && <span className={`tree-status ${status}`} title={`Status: ${status}`}><span />{status}</span>}
      </div>
      {expanded && item.children.map((child, childIndex) => <TreeNode key={child.id} item={child} depth={depth + 1} parentId={item.id} index={childIndex} renamingId={renamingId} onBeginRename={onBeginRename} onContext={onContext} onDropItem={onDropItem} />)}
    </div>
  );
}

function Extensions(): React.JSX.Element {
  const plugins = useIdeStore((state) => state.snapshot?.plugins ?? []);
  const [query, setQuery] = useState('');
  const filtered = plugins.filter((plugin) => `${plugin.name} ${plugin.id} ${plugin.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="pane-content extensions-list">
      <PaneHeader title="PLUGINS" action={<button title="Reload" onClick={() => void window.machina.plugins.reload()}><RefreshCw size={14} /></button>} />
      <div className="explorer-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed" /></div>
      {plugins.length === 0 && <div className="empty-state"><Package size={28} /><strong>No plugins installed</strong><span>Open the Plugin Library to browse available plugins.</span></div>}
      {plugins.length > 0 && filtered.length === 0 && <div className="empty-state"><Search size={28} /><strong>No matching plugins</strong><span>Try a different search.</span></div>}
      {filtered.map((plugin) => <div className={`extension-card ${plugin.status}`} key={`${plugin.source}-${plugin.id}`}><div className="extension-icon"><Package size={19} /></div><div className="extension-copy"><strong>{plugin.name}</strong><span>{plugin.manifest?.version ?? 'Invalid manifest'} · {plugin.source}</span><small>{plugin.status}</small>{plugin.diagnostics.map((item, index) => <em key={index}>{item.message}</em>)}</div><label className="switch"><input type="checkbox" checked={plugin.enabled} disabled={plugin.status === 'invalid'} onChange={(event) => void window.machina.plugins.setEnabled(plugin.id, event.target.checked)} /><span /></label></div>)}
    </div>
  );
}

function WorkArea({ commands }: { commands: CommandItem[] }): React.JSX.Element {
  const workspace = useIdeStore((state) => state.workspace);
  const selectedId = useIdeStore((state) => state.selectedId);
  const notify = useIdeStore((state) => state.notify);
  const contributions = useIdeStore((state) => state.snapshot?.contributions ?? []);
  const project = useIdeStore((state) => state.snapshot?.project);
  const [renderMode, setRenderMode] = useState<'shaded' | 'wireframe'>('shaded');
  const [frameToken, setFrameToken] = useState(0);
  const [scene, setScene] = useState<SceneAsset | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const sceneSources = useMemo(() => contributions.flatMap((entry) => {
    const pluginState = project?.pluginState[entry.pluginId] as Record<string, unknown> | undefined;
    return entry.contributes.windows.filter((window) => window.kind === 'viewportScene').flatMap((window) => {
      const records = pluginState?.[window.stateKey];
      if (!Array.isArray(records)) return [];
      return records.flatMap((record): SystemSceneSource[] => {
        if (!record || typeof record !== 'object') return [];
        const model = record as Record<string, unknown>;
        if (typeof model.id !== 'string' || typeof model.assetPath !== 'string') return [];
        const bodies = Array.isArray(model.bodies) ? model.bodies.flatMap((body) => {
          if (!body || typeof body !== 'object') return [];
          const value = body as Record<string, unknown>;
          return typeof value.meshIndex === 'number' ? [{ meshIndex: value.meshIndex, visible: value.visible !== false }] : [];
        }) : [];
        return [{ id: model.id, assetPath: model.assetPath, bodies }];
      });
    });
  }), [contributions, project]);
  const sceneSourceSignature = JSON.stringify(sceneSources);
  useEffect(() => {
    let active = true;
    const sources = JSON.parse(sceneSourceSignature) as SystemSceneSource[];
    setSceneError(null);
    if (sources.length === 0) { setScene(null); setSceneLoading(false); return () => { active = false; }; }
    setSceneLoading(true);
    setScene(null);
    void (async () => {
      const meshes: SceneAsset['meshes'] = [];
      let failures = 0;
      for (const source of sources) {
        if (!active) return;
        try {
          const parsed = sceneAssetSchema.safeParse(await window.machina.project.readAsset(source.assetPath));
          if (!parsed.success) throw new Error(`Invalid scene asset: ${source.assetPath}`);
          const visibleMeshes = source.bodies.length === 0
            ? parsed.data.meshes
            : parsed.data.meshes.filter((_mesh, index) => source.bodies.find((body) => body.meshIndex === index)?.visible !== false);
          meshes.push(...visibleMeshes.map((mesh, index) => ({ ...mesh, name: `${source.id}:${mesh.name || `Mesh ${index + 1}`}` })));
          if (active && meshes.length > 0) setScene({ version: 1, meshes: [...meshes] });
        } catch {
          failures += 1;
        }
      }
      if (!active) return;
      setSceneError(failures > 0 ? `${failures} imported model${failures === 1 ? '' : 's'} could not be loaded.` : null);
      setSceneLoading(false);
    })();
    return () => { active = false; };
  }, [sceneSourceSignature]);
  if (workspace === 'extensions') return <PluginLibrary />;
  const toolbar = contributions.flatMap((item) => item.contributes.toolbarActions).map((action) => commands.find((command) => command.id === action.command)).filter(Boolean) as CommandItem[];
  return (
    <section className="work-area">
      <EditorTabs icon={<Box size={13} />} title="System 3D Viewport" />
      <div className="viewport-toolbar"><div><button className="active" title="Selection mode"><MousePointer2 size={15} /></button><button title="Frame model" onClick={() => setFrameToken((value) => value + 1)}><Maximize2 size={15} /></button></div><div className="toolbar-center"><button className={renderMode === 'shaded' ? 'active' : ''} onClick={() => setRenderMode('shaded')}>Shaded</button><button className={renderMode === 'wireframe' ? 'active' : ''} onClick={() => setRenderMode('wireframe')}>Wireframe</button>{toolbar.map((command) => <button key={command.id} className="plugin-toolbar" onClick={() => void window.machina.commands.execute(command.id, { target: selectedId }).then((result) => notify(String(result)))}><Sparkles size={13} />{command.title}</button>)}</div></div>
      <Viewport key={frameToken} renderMode={renderMode} scene={scene} emptyTitle={project ? (sceneLoading ? 'Loading system…' : sceneError ?? 'No 3D geometry in this system') : 'No project open'} emptyMessage={project ? (sceneError ?? 'Import geometry to add it to the system viewport.') : 'Create or open a project to begin.'} />
    </section>
  );
}

function EditorTabs({ icon, title }: { icon: React.ReactNode; title: string }): React.JSX.Element {
  return <div className="editor-tabs"><div className="editor-tab-label">{icon}<span>{title}</span></div></div>;
}

function PluginWindow({ descriptor }: { descriptor: PluginWindowDescriptor }): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot);
  const state = snapshot?.project?.pluginState[descriptor.pluginId] as Record<string, unknown> | undefined;
  const value = state?.[descriptor.stateKey];
  if (descriptor.kind === 'json') {
    return <section className="work-area"><EditorTabs icon={<Package size={13} />} title={descriptor.title} /><pre className="plugin-json-view">{JSON.stringify(value ?? null, null, 2)}</pre></section>;
  }
  return <div className="empty-state"><Package size={28} /><strong>{descriptor.title}</strong><span>This plugin window type is unavailable.</span></div>;
}

function PluginLibrary(): React.JSX.Element {
  const notify = useIdeStore((state) => state.notify);
  const [library, setLibrary] = useState<PluginLibraryState | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'discover' | 'installed' | 'updates'>('discover');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    try { setLibrary(await window.machina.plugins.getLibrary(refresh)); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  const entries = (library?.entries ?? []).filter((entry) => {
    if (tab === 'installed' && !entry.installedVersion) return false;
    if (tab === 'updates' && !entry.updateAvailable) return false;
    const search = `${entry.name} ${entry.description} ${entry.publisher} ${entry.categories.join(' ')}`.toLowerCase();
    return search.includes(query.trim().toLowerCase());
  });
  const act = async (entry: PluginLibraryEntry, operation: 'install' | 'remove' | 'toggle') => {
    const permissions = entry.permissions.length ? entry.permissions.join(', ') : 'No elevated permissions';
    if (operation === 'install' && !window.confirm(`${entry.updateAvailable ? 'Update' : 'Install'} ${entry.name}?\n\nPermissions: ${permissions}`)) return;
    if (operation === 'remove' && !window.confirm(`Remove ${entry.name}?\n\nProject data created by the plugin will be preserved.`)) return;
    setBusy(entry.id);
    try {
      if (operation === 'install') await window.machina.plugins.install(entry.id);
      else if (operation === 'remove') await window.machina.plugins.uninstall(entry.id);
      else await window.machina.plugins.setEnabled(entry.id, !entry.enabled);
      await load();
      notify(operation === 'remove' ? `${entry.name} removed` : operation === 'toggle' ? `${entry.name} ${entry.enabled ? 'disabled' : 'enabled'}` : `${entry.name} installed`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };
  const updateCount = library?.entries.filter((entry) => entry.updateAvailable).length ?? 0;
  return (
    <section className="work-area plugin-library">
      <div className="plugin-library-header">
        <div><p>PLUGIN LIBRARY</p><h1>Extend Machina</h1><span>Install trusted engineering tools without leaving the IDE.</span></div>
        <button className="library-refresh" disabled={busy !== null} onClick={() => void load(true)}><RefreshCw size={14} /> Check for updates</button>
      </div>
      <div className="library-toolbar">
        <div className="library-tabs"><button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>Discover</button><button className={tab === 'installed' ? 'active' : ''} onClick={() => setTab('installed')}>Installed</button><button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>Updates{updateCount > 0 && <span>{updateCount}</span>}</button></div>
        <label className="library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" /></label>
      </div>
      {library?.message && <div className="library-notice"><CircleAlert size={14} />{library.message}</div>}
      {!library && <div className="domain-empty"><RefreshCw className="spin" size={30} /><strong>Loading plugin library</strong></div>}
      {library && entries.length === 0 && <div className="domain-empty"><Package size={34} /><strong>{tab === 'updates' ? 'All plugins are up to date' : 'No matching plugins'}</strong><span>{tab === 'installed' ? 'Install a plugin from Discover to add it here.' : 'Try another search.'}</span></div>}
      <div className="plugin-market-grid">{entries.map((entry) => <article key={entry.id} className="market-card">
        <div className="market-icon"><Package size={26} /></div>
        <div className="market-copy"><div className="market-title"><strong>{entry.name}</strong>{entry.verified && <ShieldCheck size={14} aria-label="Verified publisher" />}</div><span>{entry.publisher} · {entry.version}</span><p>{entry.description}</p><div className="market-tags">{entry.categories.map((category) => <span key={category}>{category}</span>)}</div></div>
        <div className="market-actions">
          {entry.homepage && <button className="icon-button" title="Plugin homepage" onClick={() => window.open(entry.homepage, '_blank')}><ExternalLink size={14} /></button>}
          {entry.installedVersion && entry.installedSource !== 'bundled' && <button className="icon-button danger" title="Remove plugin" disabled={busy === entry.id} onClick={() => void act(entry, 'remove')}><Trash2 size={14} /></button>}
          {entry.installedVersion && <label className="switch" title={entry.enabled ? 'Disable plugin' : 'Enable plugin'}><input type="checkbox" checked={Boolean(entry.enabled)} disabled={busy === entry.id || entry.status === 'invalid'} onChange={() => void act(entry, 'toggle')} /><span /></label>}
          {entry.updateAvailable && <button className="market-primary" disabled={busy === entry.id} onClick={() => void act(entry, 'install')}>{busy === entry.id ? 'Updating…' : 'Update'}</button>}
          {!entry.installedVersion && <button className="market-primary" disabled={busy === entry.id} onClick={() => void act(entry, 'install')}>{busy === entry.id ? 'Installing…' : 'Install'}</button>}
          {entry.bundled && !entry.updateAvailable && <span className="included-badge">Included</span>}
        </div>
      </article>)}</div>
    </section>
  );
}

function Inspector(): React.JSX.Element {
  const snapshot = useIdeStore((state) => state.snapshot)!;
  const selectedId = useIdeStore((state) => state.selectedId);
  const item = findProjectItem(getProjectTree(snapshot), selectedId);
  const sections = snapshot.contributions.flatMap((entry) => entry.contributes.inspectorSections.map((section) => ({ ...section, pluginId: entry.pluginId }))).filter((section) => item && section.itemTypes.includes(item.type)).sort((a, b) => b.priority - a.priority);
  if (!item) return <div className="pane-content"><PaneHeader title="INSPECTOR" /><div className="empty-state"><MousePointer2 size={28} /><span>Select a project item</span></div></div>;
  const engineeringStatus = typeof item.properties.status === 'string' ? item.properties.status : null;
  const contributedKeys = new Set(sections.flatMap((section) => section.properties.map((property) => property.key)));
  const coreEntries = Object.entries(item.properties).filter(([key, value]) => !['id', 'name', 'status', 'type', 'bodies'].includes(key) && !contributedKeys.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  const coreProperties = Object.fromEntries(coreEntries.map(([key, value]) => [titleCase(key), key === 'completedAt' ? formatDateTime(String(value)) : formatPropertyValue(value)]));
  const coreEdits = Object.fromEntries(coreEntries.filter(([key]) => !['assetPath', 'importedAt', 'fileName', 'meshCount', 'triangleCount', 'meshIndex'].includes(key)).map(([key, value]) => [titleCase(key), { key, value, type: typeof value === 'boolean' ? 'boolean' as const : typeof value === 'number' ? 'number' as const : 'string' as const }]));
  return (
    <div className="pane-content inspector">
      <PaneHeader title="INSPECTOR" />
      <div className="selection-heading"><div className="selection-icon">{projectItemIcon(item.type, 20)}</div><div><strong>{item.name}</strong><span>{item.type}</span>{engineeringStatus && <div className={`selection-status ${engineeringStatus}`}><span />{engineeringStatus}</div>}</div></div>
      <PropertySection title="Item" itemId={item.id} properties={{ Name: item.name, Type: item.type, Configuration: snapshot.project?.activeConfiguration ?? 'Default', ...(engineeringStatus ? { Status: engineeringStatus } : {}) }} edits={{ Name: { key: 'name', value: item.name, type: 'string' } }} />
      {Object.keys(coreProperties).length > 0 && <PropertySection title={inspectorSectionTitle(item.type)} itemId={item.id} properties={coreProperties} edits={coreEdits} />}
      {sections.map((section) => <PropertySection key={`${section.pluginId}-${section.id}`} title={section.title} itemId={item.id} plugin={section.pluginId} properties={Object.fromEntries(section.properties.map((property) => [property.label, resolveInspectorValue(snapshot, item, section.pluginId, property.key)]))} edits={Object.fromEntries(section.properties.filter((property) => property.type !== 'readonly').map((property) => [property.label, { key: property.key, value: resolveInspectorRaw(snapshot, item, section.pluginId, property.key), type: property.type as EditableProperty['type'] }]))} />)}
    </div>
  );
}

type EditableProperty = { key: string; value: unknown; type: 'string' | 'number' | 'boolean' };

function PropertySection({ title, properties, edits = {}, itemId, plugin }: { title: string; properties: Record<string, string>; edits?: Record<string, EditableProperty>; itemId: string; plugin?: string }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return <section className="property-section"><button className="property-heading" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{title}</strong>{plugin && <span>PLUGIN</span>}</button>{open && <div className="property-grid">{Object.entries(properties).map(([key, value]) => <div className="property-row" key={key}><label>{key}</label>{edits[key] ? <InspectorInput itemId={itemId} property={edits[key]} /> : <div>{value}</div>}</div>)}</div>}</section>;
}

function InspectorInput({ itemId, property }: { itemId: string; property: EditableProperty }): React.JSX.Element {
  const notify = useIdeStore((state) => state.notify);
  const [value, setValue] = useState(String(property.value ?? ''));
  useEffect(() => setValue(String(property.value ?? '')), [property.value]);
  const save = (next: string | boolean) => {
    const parsed = property.type === 'number' ? Number(next) : next;
    if (property.type === 'number' && !Number.isFinite(parsed)) { notify('Enter a valid number'); setValue(String(property.value ?? '')); return; }
    void window.machina.project.updateItem(itemId, { [property.key]: parsed }).catch((error) => notify(error instanceof Error ? error.message : String(error)));
  };
  if (property.type === 'boolean') return <label className="inspector-checkbox"><input type="checkbox" checked={property.value === true} onChange={(event) => save(event.target.checked)} /><span>{property.value === true ? 'Yes' : 'No'}</span></label>;
  return <input className="inspector-input" type={property.type === 'number' ? 'number' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => save(value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setValue(String(property.value ?? '')); event.currentTarget.blur(); } }} />;
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
  useEffect(() => { end.current?.scrollIntoView(); }, [output.length]);
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
  const update = useIdeStore((state) => state.updateState);
  return <footer className="status-bar"><div><span className="status-ready" /> {project ? 'Ready' : 'No project open'}</div>{project && <div><Box size={12} /> {project.activeConfiguration}</div>}<div className="status-spacer" />{update.status === 'checking' && <div><RefreshCw className="spin" size={11} /> Checking for updates</div>}{update.status === 'downloading' && <div><Download size={11} /> Update {Math.round(update.percent ?? 0)}%</div>}{update.status === 'downloaded' && <div><Download size={11} /> Update ready</div>}<div>{running ? <><span className="pulse" /> {running} task running</> : 'No active tasks'}</div>{project && <div>Saved {formatDateTime(project.updatedAt)}</div>}<div>Machina {APP_VERSION}</div></footer>;
}

function UpdatePrompt({ state, onLater }: { state: UpdateState; onLater(): void }): React.JSX.Element {
  const notify = useIdeStore((store) => store.notify);
  const install = async () => {
    try {
      await window.machina.updates.install();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  return <div className="update-prompt" role="dialog" aria-labelledby="update-title"><div className="update-icon"><Download size={22} /></div><div><strong id="update-title">Machina {state.availableVersion ?? 'update'} is ready</strong><span>Your project will be saved before Machina restarts and installs the update.</span></div><button className="secondary" onClick={onLater}>Later</button><button className="primary" onClick={() => void install()}>Restart now</button></div>;
}

function PaneHeader({ title, action }: { title: string; action?: React.ReactNode }): React.JSX.Element { return <div className="pane-header"><span>{title}</span>{action && <div>{action}</div>}</div>; }

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function titleCase(value: string): string { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
function flattenProjectItems(items: ProjectItem[]): ProjectItem[] { return items.flatMap((item) => [item, ...flattenProjectItems(item.children)]); }
function createPresetRects(id: WorkspacePresetId, pluginWindows: PluginWindowDescriptor[]): Partial<Record<WorkspaceWindowId, WindowRect>> {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  const entries: Array<[WorkspaceWindowId, WindowRect]> = CORE_WINDOWS.map((windowId, index) => {
    const presetRect = preset.windows[windowId];
    return [windowId, { ...(presetRect ?? fallbackWindowRect(index)), z: index + 1 }];
  });
  const relevant = pluginWindows.filter((window) => window.defaultWorkspaces.includes(id));
  const viewportRect = preset.windows.viewer ?? { x: 22.4, y: 0, width: 55.2, height: 70 };
  pluginWindows.forEach((window, index) => {
    const relevantIndex = relevant.findIndex((candidate) => candidate.runtimeId === window.runtimeId);
    const rect = relevantIndex >= 0
      ? { ...viewportRect, x: viewportRect.x + (viewportRect.width / relevant.length) * relevantIndex, width: viewportRect.width / relevant.length }
      : fallbackWindowRect(CORE_WINDOWS.length + index);
    entries.push([window.runtimeId, { ...rect, z: CORE_WINDOWS.length + index + 1 }]);
  });
  return Object.fromEntries(entries) as Partial<Record<WorkspaceWindowId, WindowRect>>;
}

function hiddenForPreset(id: WorkspacePresetId, pluginWindows: PluginWindowDescriptor[]): Set<WorkspaceWindowId> {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  const relevant = pluginWindows.filter((window) => window.defaultWorkspaces.includes(id));
  const hidden = new Set<WorkspaceWindowId>(CORE_WINDOWS.filter((windowId) => !preset.windows[windowId]));
  pluginWindows.filter((window) => !window.defaultWorkspaces.includes(id)).forEach((window) => hidden.add(window.runtimeId));
  if (relevant.length > 0) hidden.add('viewer');
  return hidden;
}

function presetWindowOrder(id: WorkspacePresetId, pluginWindows: PluginWindowDescriptor[]): WorkspaceWindowId[] {
  const preset = WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0]!;
  const visible = Object.keys(preset.windows) as WorkspaceWindowId[];
  const pluginIds = pluginWindows.map((window) => window.runtimeId);
  return [...visible, ...pluginIds.filter((windowId) => !visible.includes(windowId)), ...CORE_WINDOWS.filter((windowId) => !visible.includes(windowId))];
}

function fallbackWindowRect(index: number): WindowRect { return { x: 8 + (index % 5) * 4, y: 7 + (index % 4) * 4, width: 46, height: 44, z: index + 1 }; }

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

function workspaceWindowMeta(id: WorkspaceWindowId, pluginWindows: PluginWindowDescriptor[]): WindowMeta {
  const meta: Record<CoreWindowId, WindowMeta> = {
    project: { title: 'Project', icon: <PanelLeft size={13} /> },
    viewer: { title: 'System Model', icon: <LayoutGrid size={13} /> },
    console: { title: 'Console', icon: <PanelBottom size={13} /> },
    inspector: { title: 'Inspector', icon: <PanelRight size={13} /> },
    extensions: { title: 'Plugin Library', icon: <Package size={13} /> },
  };
  if (id in meta) return meta[id as CoreWindowId];
  const plugin = pluginWindows.find((window) => window.runtimeId === id);
  return plugin ? { title: plugin.title, icon: <Package size={13} />, plugin: true } : { title: 'Extension Window', icon: <Package size={13} />, plugin: true };
}

function projectItemsForWorkspace(items: Array<ProjectItem | VirtualItem>, workspace: string): Array<ProjectItem | VirtualItem> {
  if (workspace === 'project') return items;
  const matches = (item: ProjectItem | VirtualItem) => workspace === 'design'
    ? item.type === 'core.assembly' || item.type.startsWith('dev.machina.step.')
    : workspace === 'electronics'
      ? item.type.includes('electronics')
      : workspace === 'software'
        ? item.type.includes('software')
        : true;
  const filterTree = (item: ProjectItem | VirtualItem): ProjectItem | VirtualItem | null => {
    const children = item.children.map(filterTree).filter((child): child is ProjectItem | VirtualItem => child !== null);
    if (matches(item) || (item.type === 'core.folder' && children.length > 0)) return { ...item, children };
    return null;
  };
  return items.map(filterTree).filter((item): item is ProjectItem | VirtualItem => item !== null);
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
  return formatPropertyValue(resolveInspectorRaw(snapshot, item, pluginId, key) ?? '—');
}

function resolveInspectorRaw(snapshot: AppSnapshot, item: ProjectItem | VirtualItem, pluginId: string, key: string): unknown {
  if (key in item.properties) return item.properties[key];
  const state = snapshot.project?.pluginState[pluginId] as Record<string, unknown> | undefined;
  if (state && key in state) return state[key];
  return undefined;
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function humanizeDiagnostic(message: string): string {
  return message.replace(/Invalid string: must match pattern \/[^/]+\//g, 'Does not match the required format').replace('Invalid option: expected one of ', 'Unsupported permission. Allowed: ');
}
