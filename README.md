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

## Spine License Requirement

The renderer ships with the Spine Runtimes (`@esotericsoftware/spine-pixi-v8`) bundled into the
extension, so it works in any workspace with no project setup.

The Spine Runtimes are not MIT licensed. Under the Spine Runtimes License Agreement, **each user
of this extension must hold their own Spine Editor license.** The full agreement is included as
`LICENSE-spine-runtimes.txt` and is preserved in the bundled runtime.

## Troubleshooting

If the preview panel opens but the canvas does not render, check:

- `View > Output > Spine Viewer`
- Whether the skeleton JSON, atlas file, and atlas page images are in the same folder
- Whether the atlas page names exactly match the image filenames

## Known Limitations

- Binary `.skel` files are not supported yet.
- Rendering currently targets Spine runtime assets compatible with `@esotericsoftware/spine-pixi-v8`.
- The extension expects atlas images to be local workspace files.

## License

This extension is MIT licensed. See `LICENSE`.

The bundled Spine Runtimes are licensed separately under the
[Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)
and require each user to hold a Spine Editor license. See `LICENSE-spine-runtimes.txt`.

Pixi.js is MIT licensed.
