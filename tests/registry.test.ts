import { describe, expect, it } from 'vitest';
import { CapabilityRegistry, DisposableStore, Registry } from '@mechatronics-ide/core';

describe('registries', () => {
  it('disposes registrations idempotently', () => {
    const registry = new Registry<{ id: string; value: number }>();
    const store = new DisposableStore();
    store.add(registry.register({ id: 'fixture', value: 42 }));
    expect(registry.get('fixture')?.value).toBe(42);
    store.dispose();
    store.dispose();
    expect(registry.get('fixture')).toBeUndefined();
  });

  it('gates capability resolution on provider readiness', () => {
    const capabilities = new CapabilityRegistry();
    capabilities.provide({ id: 'simulation', capability: 'simulation.runner', ready: false, api: { run: true } });
    expect(() => capabilities.resolve('simulation.runner')).toThrow('not ready');
    capabilities.provide({ id: 'simulation-ready', capability: 'simulation.runner', ready: true, api: { run: true } });
    expect(capabilities.resolve<{ run: boolean }>('simulation.runner').run).toBe(true);
  });
});
