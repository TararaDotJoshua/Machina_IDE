import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectService } from '../src/main/project-service';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('project persistence', () => {
  it('round-trips unknown namespaced plugin data without loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'machina-project-test-'));
    temporaryRoots.push(root);
    const projectRoot = join(root, 'Round Trip.mechatronics');
    const service = new ProjectService();
    await service.createAt(projectRoot, 'Round Trip');
    const opaqueState = {
      nested: { futureSchema: 9, values: [1, 'two', { untouched: true }] },
      binaryReference: 'assets/plugin-blob.bin',
    };
    await service.setPluginState('future.plugin.unavailable', opaqueState);

    const reopened = new ProjectService();
    const document = await reopened.load(projectRoot);
    expect(document.pluginState['future.plugin.unavailable']).toEqual(opaqueState);
    const disk = JSON.parse(await readFile(join(projectRoot, 'project.json'), 'utf8'));
    expect(disk.pluginState['future.plugin.unavailable']).toEqual(opaqueState);
  });
});
