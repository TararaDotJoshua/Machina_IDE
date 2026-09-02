import { build } from 'esbuild';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pluginsRoot = join(root, 'plugins');
const runtimeOut = join(root, 'dist', 'plugin-runtime');
const testFixtureOut = join(root, 'dist', 'test-fixtures');

await mkdir(runtimeOut, { recursive: true });
await build({
  entryPoints: [join(root, 'packages', 'plugin-host', 'src', 'host-runner.ts')],
  outfile: join(runtimeOut, 'host-runner.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  target: 'node20',
  sourcemap: true,
});

await mkdir(testFixtureOut, { recursive: true });
await build({
  entryPoints: [join(root, 'tests', 'fixtures', 'host-plugin.ts')],
  outfile: join(testFixtureOut, 'host-plugin.cjs'),
  platform: 'node',
  format: 'cjs',
  bundle: true,
  target: 'node20',
});

let pluginEntries = [];
try { pluginEntries = await readdir(pluginsRoot, { withFileTypes: true }); } catch { /* no bundled extensions */ }
for (const entry of pluginEntries) {
  if (!entry.isDirectory()) continue;
  const pluginRoot = join(pluginsRoot, entry.name);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(pluginRoot, 'manifest.json'), 'utf8'));
  } catch {
    continue;
  }
  const entryPoints = [];
  if (manifest.main && (await exists(join(pluginRoot, 'src', 'main.ts')))) {
    entryPoints.push({ in: join(pluginRoot, 'src', 'main.ts'), out: 'main' });
  }
  for (const worker of manifest.contributes?.workers ?? []) {
    const source = join(pluginRoot, 'src', `${worker.id}.ts`);
    if (await exists(source)) entryPoints.push({ in: source, out: worker.id });
  }
  if (entryPoints.length) {
    await build({
      entryPoints,
      outdir: join(pluginRoot, 'dist'),
      platform: 'node',
      format: 'cjs',
      bundle: true,
      target: 'node20',
      sourcemap: true,
      outExtension: { '.js': '.cjs' },
    });
  }
  if (manifest.renderer) {
    const rendererSource = join(pluginRoot, 'src', 'renderer.ts');
    if (await exists(rendererSource)) {
      await mkdir(dirname(join(pluginRoot, manifest.renderer)), { recursive: true });
      await build({
        entryPoints: [rendererSource],
        outfile: join(pluginRoot, manifest.renderer),
        platform: 'browser',
        format: 'esm',
        bundle: true,
        target: 'es2022',
      });
    }
  }
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
