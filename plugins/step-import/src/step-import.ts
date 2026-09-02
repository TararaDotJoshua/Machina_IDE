import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import createOcct from 'occt-import-js';

interface ImportArguments {
  sourcePath: string;
  projectRoot: string;
  modelId: string;
  name: string;
  linearUnit: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
}

interface OcctMesh {
  name?: unknown;
  color?: unknown;
  attributes?: { position?: { array?: unknown }; normal?: { array?: unknown } };
  index?: { array?: unknown };
}

function send(message: unknown): void {
  process.send?.(message);
}

function progress(percent: number, message: string): void {
  send({ type: 'progress', percent, message });
}

function numericArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`OpenCASCADE returned invalid ${label}`);
  const flattened = value.flat(2);
  if (!flattened.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error(`OpenCASCADE returned non-numeric ${label}`);
  }
  return flattened as number[];
}

function safeOutputPath(projectRoot: string, modelId: string): { absolute: string; relative: string } {
  const assetsRoot = resolve(projectRoot, 'assets');
  const absolute = resolve(assetsRoot, 'step-import', `${modelId}.scene.json`);
  const child = relative(assetsRoot, absolute);
  if (!child || child === '..' || child.startsWith(`..${sep}`)) throw new Error('Invalid project asset path');
  return { absolute, relative: `assets/${child.replaceAll('\\', '/')}` };
}

async function run(): Promise<void> {
  const args = JSON.parse(process.argv[2] ?? '{}') as Partial<ImportArguments>;
  if (!args.sourcePath || !args.projectRoot || !args.modelId || !args.name || !args.linearUnit) {
    throw new Error('Incomplete STEP import request');
  }
  if (!['.step', '.stp'].includes(extname(args.sourcePath).toLowerCase())) throw new Error('Only .step and .stp files are supported');
  const sourceInfo = await stat(args.sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size === 0) throw new Error('The selected STEP file is empty or unavailable');
  if (sourceInfo.size > 512 * 1024 * 1024) throw new Error('STEP files larger than 512 MB are not supported');

  progress(5, `Reading ${basename(args.sourcePath)}`);
  const content = await readFile(args.sourcePath);
  progress(15, 'Starting OpenCASCADE');
  const occt = await createOcct();
  progress(35, 'Triangulating STEP geometry');
  const imported = occt.ReadStepFile(content, {
    linearUnit: args.linearUnit,
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  if (imported.success !== true || !Array.isArray(imported.meshes)) throw new Error('OpenCASCADE could not import this STEP file');

  let triangleCount = 0;
  const meshes = (imported.meshes as OcctMesh[]).map((mesh, index) => {
    const positions = numericArray(mesh.attributes?.position?.array, `positions for mesh ${index + 1}`);
    const indices = numericArray(mesh.index?.array, `indices for mesh ${index + 1}`).map((value) => Math.trunc(value));
    const normals = mesh.attributes?.normal?.array === undefined ? undefined : numericArray(mesh.attributes.normal.array, `normals for mesh ${index + 1}`);
    triangleCount += Math.floor(indices.length / 3);
    const rawColor = Array.isArray(mesh.color) ? mesh.color.slice(0, 3) : undefined;
    const color = rawColor?.length === 3 && rawColor.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? rawColor as [number, number, number]
      : undefined;
    return {
      name: typeof mesh.name === 'string' && mesh.name ? mesh.name : `Mesh ${index + 1}`,
      ...(color ? { color } : {}),
      positions,
      ...(normals ? { normals } : {}),
      indices,
    };
  });

  progress(80, 'Writing project geometry');
  const output = safeOutputPath(args.projectRoot, args.modelId);
  await mkdir(dirname(output.absolute), { recursive: true });
  const temporary = `${output.absolute}.tmp`;
  const serialized = JSON.stringify({ version: 1, meshes });
  if (Buffer.byteLength(serialized, 'utf8') > 128 * 1024 * 1024) {
    throw new Error('The triangulated model exceeds Machina’s 128 MB scene limit; import with coarser tessellation settings');
  }
  await writeFile(temporary, serialized, 'utf8');
  await rename(temporary, output.absolute);
  const model = {
    id: args.modelId,
    type: 'dev.machina.step.model' as const,
    name: args.name,
    fileName: basename(args.sourcePath),
    assetPath: output.relative,
    meshCount: meshes.length,
    triangleCount,
    linearUnit: args.linearUnit,
    importedAt: new Date().toISOString(),
    status: 'ready' as const,
  };
  progress(100, 'STEP import complete');
  send({ type: 'result', result: model });
}

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
