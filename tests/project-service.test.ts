import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const created = await service.createAt(projectRoot, 'Round Trip');
    expect(created.treeItems).toEqual([]);
    expect(created.treePlacements).toEqual({});
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
    await writeFile(join(projectRoot, 'assets', 'scene.json'), '{"version":1}', 'utf8');
    expect(await reopened.readAsset('assets/scene.json')).toEqual({ version: 1 });
    await expect(reopened.readAsset('project.json')).rejects.toThrow('assets directory');
  });

  it('organizes folders and edits plugin-owned tree records transactionally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'machina-project-tree-'));
    temporaryRoots.push(root);
    const service = new ProjectService();
    await service.createAt(join(root, 'Tree.mechatronics'), 'Tree');
    await service.setPluginState('dev.machina.step-import', {
      models: [{ id: 'model-1', type: 'dev.machina.step.model', name: 'Assembly', bodies: [{ id: 'body-1', type: 'dev.machina.step.body', name: 'Body', visible: true }] }],
    });
    const withFolder = await service.createFolder();
    const folder = withFolder.treeItems.find((item) => item.type === 'core.folder')!;
    await service.reorderItems(folder.id, ['model-1']);
    await service.updateItem('model-1', { name: 'Robot Assembly' });
    const updated = await service.updateItem('body-1', { visible: false, name: 'Arm Body' });

    expect(updated.treePlacements['model-1']).toEqual({ parentId: folder.id, order: 0 });
    expect(updated.pluginState['dev.machina.step-import']).toMatchObject({ models: [{ name: 'Robot Assembly', bodies: [{ name: 'Arm Body', visible: false }] }] });
  });
});
