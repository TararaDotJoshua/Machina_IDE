# STEP Import

First-party Machina IDE extension for importing ISO 10303 STEP files through OpenCASCADE.

Use **STEP Import → Import STEP Model…** from the command palette. The extension asks for a `.step` or `.stp` file, converts it in a cancellable local worker, writes the triangulated scene beneath the active project's `assets/step-import` directory, and records only metadata in its project namespace.

Imported models appear in the project tree, inspector, and the extension-owned **STEP Model** window. Source files are never modified. Failed or cancelled imports do not update project state.

Right-click an imported model and choose **Separate into bodies** to expose each converted mesh as a selectable child item. Body names and visibility can be edited in the Inspector; selecting a body isolates it in the STEP Model window.

Geometry conversion uses `occt-import-js` and its bundled OpenCASCADE WebAssembly runtime under their included licenses.
