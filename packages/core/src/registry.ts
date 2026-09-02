export interface Disposable {
  dispose(): void;
}

export class Registry<T extends { id: string }> {
  private readonly entries = new Map<string, T>();

  register(value: T): Disposable {
    if (this.entries.has(value.id)) throw new Error(`Duplicate registration: ${value.id}`);
    this.entries.set(value.id, value);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.entries.delete(value.id);
      },
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  list(): T[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface CapabilityProvider<T = unknown> {
  id: string;
  capability: string;
  ready: boolean;
  api: T;
}

export class CapabilityRegistry {
  private readonly providers = new Registry<CapabilityProvider>();

  provide<T>(provider: CapabilityProvider<T>): Disposable {
    return this.providers.register(provider as CapabilityProvider);
  }

  resolve<T>(capability: string): T {
    const provider = this.providers.list().find((item) => item.capability === capability && item.ready);
    if (!provider) throw new Error(`Capability is not ready: ${capability}`);
    return provider.api as T;
  }
}

export class DisposableStore implements Disposable {
  private readonly items = new Set<Disposable>();
  private disposed = false;

  add<T extends Disposable>(item: T): T {
    if (this.disposed) item.dispose();
    else this.items.add(item);
    return item;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of [...this.items].reverse()) item.dispose();
    this.items.clear();
  }
}
