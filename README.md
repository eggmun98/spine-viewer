# Spine Viewer

Browse and preview Spine skeleton animations directly inside VS Code.

This extension scans the current workspace for Spine skeleton JSON files, pairs each skeleton with a matching atlas in the same folder, and lets you play every animation from a single preview panel.

## Features

- Workspace-wide Spine skeleton list
- Animation selector for each skeleton
- Loop toggle
- Manual scale input
- Mouse drag to pan the preview
- Mouse wheel zoom
- Double-click or Reset button to restore the view
- Supports atlas pages using `.png`, `.webp`, `.jpg`, and `.jpeg`

## Usage

1. Open a project that contains Spine assets.
2. Open the Command Palette.
3. Run `Spine Viewer: Open Spine Browser`.
4. Select a skeleton from the left list.
5. Choose an animation from the toolbar.

On macOS the Command Palette shortcut is `Cmd+Shift+P`. On Windows and Linux it is `Ctrl+Shift+P`.

## Asset Discovery

The extension scans these workspace paths:

- `static/assets/spines/**/*.json`
- `public/assets/spines/**/*.json`
- `assets/spines/**/*.json`
- `src/assets/spines/**/*.json`

Each skeleton JSON is matched with an `.atlas` file in the same folder. The extension first checks for an atlas with the same base name as the JSON file, then falls back to the folder's available atlas files.

## Runtime Requirement

The preview renderer uses the project's existing Vite dependency cache for:

- `pixi.js`
- `@esotericsoftware/spine-pixi-v8`

If those bundles are not available in the workspace, the extension can still list skeletons and animations, but the preview canvas cannot render.

For projects that use pnpm or npm workspaces, install dependencies and run the project or Storybook once so Vite creates `node_modules/.vite/deps`.

## Troubleshooting

If the preview panel opens but the canvas does not render, check:

- `View > Output > Spine Viewer`
- Whether the project has installed dependencies
- Whether the skeleton JSON, atlas file, and atlas page images are in the same folder
- Whether the atlas page names exactly match the image filenames

## Known Limitations

- Binary `.skel` files are not supported yet.
- Rendering currently targets Spine runtime assets compatible with `@esotericsoftware/spine-pixi-v8`.
- The extension expects atlas images to be local workspace files.

## License

MIT
