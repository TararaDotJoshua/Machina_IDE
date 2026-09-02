import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../src/main/plugin-manager';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('plugin discovery', () => {
  it('ignores ordinary folders that do not contain a plugin manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'machina-plugin-discovery-'));
    roots.push(root);
    await mkdir(join(root, 'stale-build-output', 'dist'), { recursive: true });
    await writeFile(join(root, 'stale-build-output', 'dist', 'main.cjs'), 'module.exports = {};', 'utf8');
    const manager = new PluginManager(root, join(root, 'user'), 'unused', {} as never, {} as never, {} as never, async () => null);

    const plugins = await (manager as unknown as { scanRoot(path: string, source: 'bundled'): Promise<unknown[]> }).scanRoot(root, 'bundled');

    expect(plugins).toEqual([]);
  });

  it('still reports a malformed manifest as an invalid plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'machina-plugin-discovery-'));
    roots.push(root);
    await mkdir(join(root, 'broken'), { recursive: true });
    await writeFile(join(root, 'broken', 'manifest.json'), '{not-json', 'utf8');
    const manager = new PluginManager(root, join(root, 'user'), 'unused', {} as never, {} as never, {} as never, async () => null);

    const plugins = await (manager as unknown as { scanRoot(path: string, source: 'bundled'): Promise<Array<{ status: string }>> }).scanRoot(root, 'bundled');

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.status).toBe('invalid');
  });
});
