import { EventEmitter } from 'node:events';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { OutputEntry, PluginManifest, WorkerState } from '@mechatronics-ide/core';

interface WorkerRecord {
  state: WorkerState;
  child: ChildProcess;
  timer: NodeJS.Timeout;
  definition: NonNullable<PluginManifest['contributes']['workers']>[number];
  resultReceived: boolean;
  result?: unknown;
  resolveCompletion(completion: WorkerCompletion): void;
}

interface WorkerCompletion { ok: boolean; result?: unknown; error?: string }

export class WorkerManager extends EventEmitter {
  private readonly running = new Map<string, WorkerRecord>();
  private readonly history: WorkerState[] = [];
  private readonly completions = new Map<string, { pluginId: string; promise: Promise<WorkerCompletion> }>();

  constructor() {
    super();
  }

  list(): WorkerState[] {
    return [...this.history, ...[...this.running.values()].map((record) => record.state)].map((state) => ({ ...state }));
  }

  start(pluginId: string, pluginRoot: string, definition: WorkerRecord['definition'], args?: unknown): { id: string } {
    const instanceId = randomUUID();
    const entry = resolve(pluginRoot, definition.entry);
    const child = fork(entry, [JSON.stringify(args ?? {})], {
      silent: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_CRASHPAD: '1' },
    });
    const state: WorkerState = {
      id: instanceId,
      pluginId,
      workerId: definition.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const timer = setTimeout(() => this.stop(instanceId, 'failed', 'Worker timed out'), definition.timeoutMs);
    let resolveCompletion!: (completion: WorkerCompletion) => void;
    const completion = new Promise<WorkerCompletion>((resolvePromise) => { resolveCompletion = resolvePromise; });
    const record: WorkerRecord = { state, child, timer, definition, resultReceived: false, resolveCompletion };
    this.running.set(instanceId, record);
    this.completions.set(instanceId, { pluginId, promise: completion });
    this.output(pluginId, 'info', `Worker ${definition.id} started (${instanceId.slice(0, 8)})`);
    child.stdout?.on('data', (data) => this.output(pluginId, 'info', String(data).trimEnd()));
    child.stderr?.on('data', (data) => {
      const message = String(data).trimEnd();
      if (!(message.includes('crashpad') && message.includes('TransactNamedPipe'))) {
        this.output(pluginId, 'error', message);
      }
    });
    child.on('message', (raw) => {
      if (!raw || typeof raw !== 'object') return;
      const message = raw as { type?: unknown; result?: unknown; message?: unknown; percent?: unknown };
      if (message.type === 'result') {
        record.resultReceived = true;
        record.result = message.result;
      } else if (message.type === 'progress') {
        const percent = typeof message.percent === 'number' ? ` (${Math.round(message.percent)}%)` : '';
        this.output(pluginId, 'info', `${String(message.message ?? 'Working')}${percent}`);
      }
    });
    child.on('error', (error) => this.stop(instanceId, 'failed', error.message));
    child.on('exit', (code) => {
      if (!this.running.has(instanceId)) return;
      const status = code === 0 && record.resultReceived ? 'completed' : 'failed';
      this.finish(instanceId, status, code, code === 0 ? 'Worker exited without a result' : `Worker exited with code ${code ?? 'unknown'}`);
    });
    this.emit('change');
    return { id: instanceId };
  }

  async wait(pluginId: string, instanceId: string): Promise<unknown> {
    const completion = this.completions.get(instanceId);
    if (!completion || completion.pluginId !== pluginId) throw new Error('Worker instance is unavailable');
    const outcome = await completion.promise;
    this.completions.delete(instanceId);
    if (!outcome.ok) throw new Error(outcome.error ?? 'Worker failed');
    return outcome.result;
  }

  cancel(instanceId: string): void {
    this.stop(instanceId, 'cancelled', 'Cancellation requested');
  }

  stopPlugin(pluginId: string): void {
    for (const [id, record] of this.running) if (record.state.pluginId === pluginId) this.cancel(id);
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id);
  }

  private stop(id: string, status: WorkerState['status'], message: string): void {
    const record = this.running.get(id);
    if (!record) return;
    this.output(record.state.pluginId, status === 'failed' ? 'error' : 'warn', message);
    record.child.kill();
    this.finish(id, status, null, message);
  }

  private finish(id: string, status: WorkerState['status'], exitCode: number | null, error?: string): void {
    const record = this.running.get(id);
    if (!record) return;
    clearTimeout(record.timer);
    this.running.delete(id);
    const completed = { ...record.state, status, exitCode };
    this.history.push(completed);
    if (this.history.length > 20) this.history.shift();
    this.output(record.state.pluginId, status === 'completed' ? 'info' : 'warn', `Worker ${record.state.workerId} ${status}`);
    record.resolveCompletion(status === 'completed' ? { ok: true, result: record.result } : { ok: false, error: error ?? 'Worker failed' });
    if (this.completions.size > 40) {
      const stale = [...this.completions.keys()].find((completionId) => !this.running.has(completionId));
      if (stale) this.completions.delete(stale);
    }
    this.emit('change');
  }

  private output(source: string, level: OutputEntry['level'], message: string): void {
    if (!message) return;
    this.emit('output', { source, level, message });
  }
}
