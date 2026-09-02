# Machina IDE 1.0.0

Machina IDE is a desktop-first, web-portable engineering workspace for mechatronics projects. The core application provides project persistence, rearrangeable workspaces, an interactive Three.js viewport, and a permission-gated extension runtime.

Engineering capabilities are supplied by extensions. The core never fabricates geometry, simulation output, source files, electrical schematics, or test results. STEP import remains reserved for a future first-party extension and is not bundled.

## Features

- Create, open, save, and restore local `.mechatronics` projects.
- Arrange, resize, dock, maximize, hide, and tile application windows.
- Apply System, Mechanical, Electrical, and Software workspace layouts without restricting window access.
- Browse and filter project items and inspect persisted properties.
- Navigate a Three.js engineering viewport that is ready for geometry supplied by extensions.
- Review extension diagnostics, worker activity, and application output.
- Discover, validate, enable, disable, reload, and isolate user-installed extensions.
- Receive signed stable releases through the built-in updater.

New projects are empty by design. Machina does not seed sample assemblies or display inferred engineering content.

## Updates and releases

Packaged Windows builds check the stable GitHub Releases channel shortly after startup and every four hours. Updates download in the background; Machina offers **Restart now** or **Later** and saves the open project before installing. Updates can also be checked from Help → Check for Updates.

Production publishing requires repository secrets named `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`. Push a stable tag matching the package version, such as `v1.0.0`, to run the release workflow. The workflow rejects prerelease versions and unsigned publishing, runs the complete verified build, and publishes the signed NSIS installer, blockmap, and `latest.yml` update metadata.

## Run and build

Prerequisites: Node.js 20+ and npm 10+.

```bash
npm install
npm run dev
```

Verification and packaging commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run package
npm run dist
```

The app reopens the last valid project when possible. A new installation starts without a project; use File → Create Project or File → Open Project. Projects contain `project.json` and an `assets` directory, and saves are written atomically.

## Architecture

```text
React renderer (portable; no Node access)
  │
  │ typed window.machina preload bridge
  ▼
Electron main
  ├─ ProjectService ── local project documents
  ├─ PluginManager  ── discovery, validation, policy, lifecycle
  └─ WorkerManager  ── declared processes, logs, timeout, cancellation

packages/core        shared schemas, contracts, and registries
packages/plugin-sdk  extension authoring API
packages/plugin-host isolated backend host runtime
```

The renderer consumes validated declarative contributions. Extension backends run in separate child processes and communicate through versioned, capability-limited RPC. The renderer has no direct filesystem, Node, Electron, or raw IPC access.

## Extensions

No extensions are bundled. User extensions are discovered under `<Electron userData>/plugins/*`. Open that directory through Extensions → Open Extensions Folder, add an extension folder, then choose Extensions → Reload Extensions.

Supported activation events are:

- `onStartupFinished`
- `onWorkspace:<id>`
- `onCommand:<id>`
- `onProjectItem:<type>`
- `onCapability:<name>`

Extensions may contribute commands, project item types, inspector sections, bottom panels, viewport actions, capabilities, controlled workers, and AI-callable tools. Every registration is disposable. Disabling or reloading an extension deactivates its host, removes its contributions, and terminates its workers while preserving the active project and unknown extension namespaces.

User extensions are denied `process.worker` by default. Workers stream output, observe timeouts, support cancellation, and must explicitly persist real results through the permitted project API.

## Security boundary

The Electron window uses context isolation, disables Node integration, and enables Chromium sandboxing. Packaged builds do not expose reload or developer-tools menu actions. The preload exposes named operations instead of raw IPC. Manifests and RPC messages are schema-validated, paths must remain inside the extension root, and permissions are deny-by-default.

The backend host provides process isolation, not an operating-system container. Extensions should be installed only from trusted sources until signed extension bundles and OS-level sandbox policies are available.

## Repository map

```text
src/main/              Electron entry and local services
src/preload/           narrow context bridge
src/renderer/          React workbench and Three.js viewport
packages/core/         shared schemas, contracts, and registries
packages/plugin-sdk/   extension authoring SDK
packages/plugin-host/  isolated backend host runner
scripts/               deterministic runtime bundler
tests/                 contracts, persistence, gating, and host RPC
```
