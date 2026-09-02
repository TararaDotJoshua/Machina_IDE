# Machina IDE 0.2.0-beta.2

Machina IDE is a desktop-first, web-portable engineering workspace for mechatronics projects. This prerelease establishes the application shell, local project format, rearrangeable window system, and extension runtime without pretending that unfinished engineering engines are available.

STEP import is intentionally absent. It is planned as a future first-party extension rather than a core feature.

## What works in this prerelease

- Create, open, save, and restore local `.mechatronics` projects.
- Arrange every core window freely, resize it, dock it beside another window, maximize it, or tile all visible windows.
- Apply System, Mechanical, Electrical, and Software workspace presets. Presets only change layout; every window remains available from View or the Windows menu.
- Browse and filter the project tree, select project items, and inspect their stored properties.
- Navigate an interactive Three.js view generated from the current project items, with orbit, frame reset, shaded mode, and wireframe mode.
- View electrical and firmware project data when the project contains those item types, with clear empty states otherwise.
- Review extension diagnostics, worker activity, and output logs.
- Discover, validate, enable, disable, reload, and isolate user-installed extensions.

No example extensions ship with this build. No mock simulation, sample project, fake terminal, fake source editor, fake geometry, or fabricated engineering result is included.

## Beta updates

Packaged Windows builds check the public GitHub Releases beta channel shortly after startup and every four hours. Updates download in the background; Machina then offers **Restart now** or **Later** and saves the open project before installing. Users can also run Help → Check for Updates or the corresponding command-palette action.

To publish a beta, update every workspace package to the same prerelease version, commit it, and push a matching tag such as `v0.2.0-beta.3`. The `Publish Windows Beta` GitHub Actions workflow validates the tag, runs lint and the complete verified build, then publishes the NSIS installer, blockmap, and `beta.yml` as a GitHub prerelease.

The beta pipeline currently permits unsigned Windows builds. Before public stable distribution, configure Authenticode credentials in GitHub Actions and require signing so downloaded installers can be verified against Machina's publisher identity.

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

The app opens the last valid project when possible. A new installation starts without a project; use File → Create Project or File → Open Project. Projects contain `project.json` and an `assets` directory, and saves are written atomically.

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

## User extensions

No extensions are bundled in the prerelease. User extensions are discovered under `<Electron userData>/plugins/*`. Open that directory through Developer → Open User Plugins Folder, add an extension folder, then choose Developer → Reload Extensions.

Discovery validates the manifest schema, engine compatibility, duplicate IDs, permissions, path containment, and declared entry files. Invalid extensions remain visible as diagnostics without preventing Machina IDE from starting. Enablement is stored per user profile.

Supported activation events are:

- `onStartupFinished`
- `onWorkspace:<id>`
- `onCommand:<id>`
- `onProjectItem:<type>`
- `onCapability:<name>`

Extensions may contribute commands, project item types, inspector sections, bottom panels, viewport actions, capabilities, controlled workers, and AI-callable tools. Every registration is disposable. Disabling or reloading an extension deactivates its host, removes its contributions, and terminates its workers while preserving the active project and unknown extension namespaces.

User extensions are denied `process.worker` by the default prerelease policy. The runtime supports declared workers for future trusted first-party extensions. Workers stream output, observe timeouts, support cancellation, and never generate project results on their own; an extension must explicitly persist actual results through its permitted API.

## Security boundary

The Electron window uses context isolation, disables Node integration, and enables Chromium sandboxing. The preload exposes named operations rather than raw IPC. Manifests and RPC messages are schema-validated, paths must remain inside the extension root, and permissions are deny-by-default.

The backend host is process isolation, not an operating-system container. Before a stable release, Machina IDE should add signed extension bundles, install-time consent, executable allowlists, resource quotas, authenticated channels, and stronger OS-level isolation.

## Deferred engineering features

This prerelease does not include STEP/IGES import, OpenCASCADE, geometry conversion, meshing, simulation solvers, firmware compilation, device programming, or circuit simulation. Each belongs behind a real integration or extension with explicit provenance and failure handling.

The planned first-party STEP Import extension will own its native geometry worker, conversion pipeline, progress and cancellation, generated assets, and scene contributions. It is not implemented here.

## Repository map

```text
src/main/              Electron entry and local services
src/preload/           narrow context bridge
src/renderer/          React workbench and Three.js viewport
packages/core/         shared schemas and contracts
packages/plugin-sdk/   extension authoring SDK
packages/plugin-host/  isolated backend host runner
scripts/               deterministic runtime bundler
tests/                 contracts, persistence, gating, and host RPC
```
