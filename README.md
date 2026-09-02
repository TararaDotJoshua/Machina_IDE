# Machina IDE 1.0.0-beta.7

Machina IDE is a desktop-first, web-portable engineering workspace for mechatronics projects. The core application provides project persistence, rearrangeable workspaces, an interactive Three.js viewport, and a permission-gated extension runtime.

Engineering capabilities are supplied by extensions. The core never fabricates geometry, simulation output, source files, electrical schematics, or test results. A first-party STEP Import extension ships with Machina and converts real STEP geometry through OpenCASCADE.

## Features

- Create, open, save, and restore local `.mechatronics` projects.
- Arrange, resize, dock, maximize, hide, and tile application windows.
- Restore any hidden window directly to the front as the active window.
- Apply System, Mechanical, Electrical, and Software workspace layouts without restricting window access; presets always reset floating, tiled, or cascaded windows to their saved arrangement.
- Organize project items into folders, rename them inline, and rearrange them by drag-and-drop or context-menu actions.
- Select core and plugin-owned project items reliably and edit supported values directly in the Inspector.
- View all geometry supplied by extensions together in one system-level Three.js viewport.
- Review extension diagnostics, worker activity, and application output.
- Discover, validate, enable, disable, reload, and isolate user-installed extensions.
- Import `.step` and `.stp` models into the system viewport using a cancellable local worker, separate them into selectable bodies, and delete imports with their cached geometry.
- Enter full screen with F11 without unused screen margins and choose a persistent 80–150% scale that resizes the entire interface from the View menu.
- Receive beta releases through the built-in updater, which rejects invalid, equal, and older versions.

New projects are empty by design. Machina does not seed sample assemblies or display inferred engineering content.

## Beta updates and releases

Packaged Windows builds check the GitHub Releases beta channel shortly after startup and every four hours. Updates download in the background; Machina offers **Restart now** or **Later** and saves the open project before installing. Updates can also be checked from Help → Check for Updates.

Every release must be committed and pushed to `main`, followed by a beta tag matching the package version, such as `v1.0.0-beta.7`. The tag runs the release workflow, which validates the version, runs the complete verified build, and publishes the NSIS installer, blockmap, `beta.yml`, and `latest.yml` compatibility metadata.

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

## Plugins

The first-party STEP Import plugin is bundled. Open **Plugins → Plugin Library** to browse, search, install, update, enable, disable, or remove plugins without handling files manually. The library uses a built-in catalog offline and refreshes against the project catalog on GitHub when connected.

Marketplace packages are downloaded only over HTTPS, capped by compressed and expanded size, checked against the catalog SHA-256 digest, inspected for unsafe paths and symbolic links, and validated before an atomic install. A failed install restores the previous version. Bundled plugins cannot be replaced or removed, and third-party marketplace plugins remain subject to the user-plugin permission policy.

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
