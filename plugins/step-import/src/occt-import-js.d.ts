declare module 'occt-import-js' {
  interface OcctApi {
    ReadStepFile(content: Uint8Array, options: unknown): {
      success?: unknown;
      meshes?: unknown;
    };
  }

  export default function createOcct(): Promise<OcctApi>;
}
