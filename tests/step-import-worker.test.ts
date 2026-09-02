import { afterEach, describe, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sceneAssetSchema } from '@mechatronics-ide/core';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('STEP import worker', () => {
  it('converts a STEP file into a validated project scene asset', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'machina-step-test-'));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, 'assets'));
    const workerEntry = resolve('plugins', 'step-import', 'dist', 'step-import.cjs');
    const sourcePath = resolve('tests', 'fixtures', 'cube.stp');
    const modelId = 'test-cube';
    const result = await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      const child = fork(workerEntry, [JSON.stringify({ sourcePath, projectRoot, modelId, name: 'Cube', linearUnit: 'millimeter' })], { silent: true });
      let workerResult: Record<string, unknown> | undefined;
      let errors = '';
      child.stderr?.on('data', (data) => { errors += String(data); });
      child.on('message', (message) => {
        if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'result') {
          workerResult = (message as { result: Record<string, unknown> }).result;
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 && workerResult ? resolvePromise(workerResult) : reject(new Error(errors || `Worker exited with code ${code}`)));
    });
    expect(result).toMatchObject({ id: modelId, type: 'dev.machina.step.model', name: 'Cube', status: 'ready' });
    expect(Number(result.meshCount)).toBeGreaterThan(0);
    expect(Number(result.triangleCount)).toBeGreaterThan(0);
    const asset = JSON.parse(await readFile(join(projectRoot, String(result.assetPath)), 'utf8')) as unknown;
    expect(sceneAssetSchema.parse(asset).meshes.length).toBe(Number(result.meshCount));
  }, 30_000);
});
