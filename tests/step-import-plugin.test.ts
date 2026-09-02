import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@mechatronics-ide/plugin-sdk';
import { breakIntoBodies } from '../plugins/step-import/src/main';

describe('STEP plugin commands', () => {
  it('separates an imported scene into editable body records', async () => {
    const state = { models: [{ id: 'model-1', type: 'dev.machina.step.model', name: 'Robot', assetPath: 'assets/robot.scene.json' }] };
    const setState = vi.fn(async () => undefined);
    const context = {
      project: {
        getState: vi.fn(async () => state),
        setState,
        readAsset: vi.fn(async () => ({ meshes: [{ name: 'Base', indices: [0, 1, 2] }, { name: 'Arm', indices: [0, 1, 2, 2, 3, 0] }] })),
      },
      logger: { info: vi.fn() },
    } as unknown as PluginContext;

    await expect(breakIntoBodies(context, { target: 'model-1' })).resolves.toBe('Created 2 bodies');
    expect(setState).toHaveBeenCalledWith({ models: [expect.objectContaining({ bodies: [
      expect.objectContaining({ name: 'Base', meshIndex: 0, triangleCount: 1, visible: true }),
      expect.objectContaining({ name: 'Arm', meshIndex: 1, triangleCount: 2, visible: true }),
    ] })] });
  });
});
