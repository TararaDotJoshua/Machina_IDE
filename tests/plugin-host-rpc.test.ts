import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_VERSION, rpcRequestSchema, rpcResponseSchema, type RpcResponse } from '@mechatronics-ide/core';

const children: ChildProcess[] = [];
afterEach(() => children.splice(0).forEach((child) => child.kill()));

function makeHost(): ChildProcess {
  const child = fork(
    resolve('dist/plugin-runtime/host-runner.cjs'),
    [resolve('dist/test-fixtures/host-plugin.cjs')],
    { silent: true },
  );
  children.push(child);
  return child;
}

function request(child: ChildProcess, method: string, params?: unknown): Promise<RpcResponse> {
  const id = randomUUID();
  child.send({ v: API_VERSION, kind: 'request', id, method, params });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 5_000);
    const listener = (raw: unknown) => {
      const hostRequest = rpcRequestSchema.safeParse(raw);
      if (hostRequest.success) {
        const result = hostRequest.data.method === 'project.getState' ? { records: [{ id: 'r1', value: 12 }] } : null;
        child.send({ v: API_VERSION, kind: 'response', id: hostRequest.data.id, ok: true, result });
        return;
      }
      const response = rpcResponseSchema.safeParse(raw);
      if (response.success && response.data.id === id) {
        clearTimeout(timer);
        child.off('message', listener);
        resolvePromise(response.data);
      }
    };
    child.on('message', listener);
  });
}

describe('plugin host RPC', () => {
  it('activates and invokes a registered AI handler across the process boundary', async () => {
    const child = makeHost();
    const activation = await request(child, 'activate', {
      pluginId: 'dev.machina.test-host',
      permissions: ['project.read', 'project.write', 'ai.tools', 'ui.panels'],
    });
    expect(activation.ok).toBe(true);
    const result = await request(child, 'ai.invoke', { name: 'test.records.list', input: {} });
    expect(result.ok).toBe(true);
    expect(result.result).toEqual([{ id: 'r1', value: 12 }]);
  });

  it('denies activation when a requested capability was not granted', async () => {
    const child = makeHost();
    const result = await request(child, 'activate', {
      pluginId: 'dev.machina.test-host',
      permissions: ['project.read', 'project.write'],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ai.tools');
  });
});
