import type { MachinaBridge } from '@mechatronics-ide/core';

declare global {
  interface Window {
    machina: MachinaBridge;
  }
}

export {};
