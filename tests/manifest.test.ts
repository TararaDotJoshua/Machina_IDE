import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pluginManifestSchema } from '@mechatronics-ide/core';

const valid = {
  id: 'com.example.fixture',
  name: 'Fixture',
  version: '0.1.0',
  engines: { mechatronicsIDE: '^0.1.0' },
  main: 'dist/main.js',
  renderer: 'dist/renderer.js',
  activationEvents: ['onStartupFinished', 'onCommand:fixture.run'],
  permissions: ['project.read'],
  contributes: {},
};

describe('plugin manifest validation', () => {
  it('normalizes a valid manifest and contribution defaults', () => {
    const result = pluginManifestSchema.parse(valid);
    expect(result.contributes.commands).toEqual([]);
    expect(result.permissions).toEqual(['project.read']);
  });

  it('rejects malformed ids, activation events, and unknown permissions', () => {
    const result = pluginManifestSchema.safeParse({
      ...valid,
      id: 'Bad ID',
      activationEvents: ['eventually'],
      permissions: ['filesystem.everything'],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });

  it('validates the bundled STEP importer contract', async () => {
    const manifest = JSON.parse(await readFile(resolve('plugins', 'step-import', 'manifest.json'), 'utf8')) as unknown;
    const result = pluginManifestSchema.parse(manifest);
    expect(result.id).toBe('dev.machina.step-import');
    expect(result.permissions).toContain('process.worker');
    expect(result.contributes.windows).toMatchObject([{ kind: 'viewportScene', stateKey: 'models' }]);
    expect(result.contributes.workers).toMatchObject([{ id: 'step-import', timeoutMs: 300_000 }]);
  });
});
