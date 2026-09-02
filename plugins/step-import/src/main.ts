import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { definePlugin, type PluginContext } from '@mechatronics-ide/plugin-sdk';

interface StepModelRecord {
  id: string;
  type: 'dev.machina.step.model';
  name: string;
  fileName: string;
  assetPath: string;
  meshCount: number;
  triangleCount: number;
  linearUnit: string;
  importedAt: string;
  status: 'ready';
  bodies?: StepBodyRecord[];
}

interface StepBodyRecord {
  id: string;
  type: 'dev.machina.step.body';
  name: string;
  meshIndex: number;
  triangleCount: number;
  visible: boolean;
}

interface SceneAssetRecord {
  meshes: Array<{ name: string; indices: number[] }>;
}

interface StepPluginState {
  models: StepModelRecord[];
}

function normalizeState(value: StepPluginState | undefined): StepPluginState {
  return { models: Array.isArray(value?.models) ? value.models : [] };
}

async function importStep(context: PluginContext): Promise<string | null> {
  const sourcePath = await context.files.open({
    title: 'Import STEP Model',
    extensions: ['step', 'stp'],
  });
  if (!sourcePath) return null;
  const projectRoot = await context.project.getRoot();
  if (!projectRoot) throw new Error('Create or open a project before importing a STEP model');

  const modelId = randomUUID();
  const fileName = basename(sourcePath);
  const worker = await context.workers.start('step-import', {
    sourcePath,
    projectRoot,
    modelId,
    name: fileName.replace(/\.(step|stp)$/i, ''),
    linearUnit: 'millimeter',
  });
  const model = await worker.result<StepModelRecord>();
  const state = normalizeState(await context.project.getState<StepPluginState>());
  await context.project.setState({ models: [...state.models.filter((item) => item.id !== model.id), model] });
  context.logger.info(`Imported ${model.fileName}: ${model.meshCount} meshes, ${model.triangleCount} triangles`);
  return `Imported ${model.name}`;
}

export async function breakIntoBodies(context: PluginContext, args?: unknown): Promise<string> {
  const target = args && typeof args === 'object' && typeof (args as { target?: unknown }).target === 'string'
    ? (args as { target: string }).target
    : '';
  if (!target) throw new Error('Select an imported STEP model first');
  const state = normalizeState(await context.project.getState<StepPluginState>());
  const model = state.models.find((item) => item.id === target);
  if (!model) throw new Error('The selected item is not an imported STEP model');
  if (model.bodies?.length) return `${model.name} is already separated into ${model.bodies.length} bodies`;
  const scene = await context.project.readAsset<SceneAssetRecord>(model.assetPath);
  if (!Array.isArray(scene.meshes) || scene.meshes.length === 0) throw new Error('The imported model has no separable bodies');
  const bodies: StepBodyRecord[] = scene.meshes.map((mesh, index) => ({
    id: `${model.id}:body:${index}`,
    type: 'dev.machina.step.body',
    name: mesh.name || `Body ${index + 1}`,
    meshIndex: index,
    triangleCount: Math.floor((mesh.indices?.length ?? 0) / 3),
    visible: true,
  }));
  await context.project.setState({ models: state.models.map((item) => item.id === model.id ? { ...item, bodies } : item) });
  context.logger.info(`Separated ${model.name} into ${bodies.length} bodies`);
  return `Created ${bodies.length} bodies`;
}

export async function deleteStepImport(context: PluginContext, args?: unknown): Promise<string> {
  const target = args && typeof args === 'object' && typeof (args as { target?: unknown }).target === 'string'
    ? (args as { target: string }).target
    : '';
  if (!target) throw new Error('Select an imported STEP model first');
  const state = normalizeState(await context.project.getState<StepPluginState>());
  const model = state.models.find((item) => item.id === target);
  if (!model) throw new Error('The selected item is not an imported STEP model');
  await context.project.setState({ models: state.models.filter((item) => item.id !== target) });
  try {
    await context.project.deleteAsset(model.assetPath);
  } catch (error) {
    context.logger.warn(`Removed ${model.name}, but its cached scene could not be deleted: ${error instanceof Error ? error.message : String(error)}`);
  }
  context.logger.info(`Deleted STEP import ${model.name}`);
  return `Deleted ${model.name}`;
}

export default definePlugin({
  async activate(context) {
    context.commands.registerCommand('machina.step.import', () => importStep(context));
    context.commands.registerCommand('machina.step.breakIntoBodies', (args) => breakIntoBodies(context, args));
    context.commands.registerCommand('machina.step.deleteImport', (args) => deleteStepImport(context, args));
    context.ai.registerTool('machina.step.listModels', async () => {
      const state = normalizeState(await context.project.getState<StepPluginState>());
      return {
        models: state.models.map(({ id, name, fileName, meshCount, triangleCount, linearUnit, importedAt }) => ({
          id,
          name,
          fileName,
          meshCount,
          triangleCount,
          linearUnit,
          importedAt,
        })),
      };
    });
  },
});
