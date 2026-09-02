import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface Settings {
  pluginEnablement: Record<string, boolean>;
  interfaceScale?: number;
  lastProject?: string;
}

export class SettingsStore {
  private data: Settings = { pluginEnablement: {} };

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.data = { ...this.data, ...(JSON.parse(await readFile(this.file, 'utf8')) as Settings) };
    } catch {
      await this.save();
    }
  }

  isPluginEnabled(id: string): boolean {
    return this.data.pluginEnablement[id] ?? true;
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    this.data.pluginEnablement[id] = enabled;
    await this.save();
  }

  get lastProject(): string | undefined {
    return this.data.lastProject;
  }

  async setLastProject(path: string): Promise<void> {
    this.data.lastProject = path;
    await this.save();
  }

  get interfaceScale(): number {
    const value = this.data.interfaceScale;
    return typeof value === 'number' && value >= 0.75 && value <= 2 ? value : 1;
  }

  async setInterfaceScale(value: number): Promise<void> {
    this.data.interfaceScale = Math.max(0.75, Math.min(2, value));
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }
}
