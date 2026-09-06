# Spine Viewer

Browse and preview Spine skeleton animations directly inside VS Code.

Every skeleton in the workspace shows up in a sidebar tree, grouped by folder. Click one to play its animations.

![Browsing and playing Spine skeletons inside VS Code](https://raw.githubusercontent.com/eggmun98/spine-viewer/main/docs/demo.gif)

## Features

- Sidebar tree of every skeleton in the workspace, grouped by folder
- Works with any folder layout: skeletons are found by their `.atlas`, not by a fixed assets path
- Animation selector for each skeleton
- Four animation tracks, so a base move and an overlay can be previewed together
- Skin selector for skeletons that ship more than one skin
- Event timeline: a marker for every event key, a playhead, and the values as they fire
- Playback speed, for checking timing frame by frame
- Loop toggle
- Manual scale input
- Mouse drag to pan the preview
- Mouse wheel zoom
- Double-click or Reset button to restore the view
- Supports atlas pages using `.png`, `.webp`, `.jpg`, and `.jpeg`

## Usage

1. Open a project that contains Spine assets.
2. Click the Spine Viewer icon in the Activity Bar.
3. Expand a folder and click a skeleton.
4. Choose an animation from the toolbar.

Use the refresh button in the view title after adding or re-exporting assets.

## Try It

The repository ships seven small demo skeletons under `examples/`. Clone it, open the folder in
VS Code, and they appear in the sidebar — no Spine editor or project setup needed.

```
pirate-game/assets/spines
  characters
    hero          idle, wave, walk
    parrot        idle, fly
  ui
    chest         idle, open
    coin          idle, spin
space-game/assets/spines
  effects
    explosion     burst, idle
    thruster      idle, boost
  ui / coin       idle, spin
```

## Tracks

Spine plays animations in layers: a walk on track 0, a wave on track 1, a blink on track 2. The
track row under the toolbar mirrors that. Pick a track, choose an animation, and it is applied
there; **Clear** empties the selected track. The event timeline follows whichever track is
selected.

## Events

Animations that carry event keys get a timeline under the preview. Each marker sits at the event's
time, the playhead tracks playback, and a marker flashes as its event fires. Click any marker to
print its name, time, and int/float/string values.

Animations without events do not show the timeline. Slow the playback speed down to read events
that fire close together.

## Asset Discovery

The extension looks for `.atlas` files anywhere in the workspace and treats the `.json` files
beside them as skeletons. Nothing is assumed about your folder names, so `static/assets/spines`,
`Assets/Spine`, and `art/animations` all work the same way.

Build output and dependency folders are skipped: `node_modules`, `.git`, `dist`, `build`, `out`,
`coverage`, `storybook-static`, `.svelte-kit`, `.next`, `.nuxt`, `.cache`.

The tree hides path segments that every skeleton shares and folds away folders that hold a single
skeleton, so it starts where your assets actually differ.

Each skeleton is paired with an atlas in its own folder: one matching the skeleton's name if there
is one, otherwise one named after the folder, otherwise the first atlas found. Skeleton files are
only read when you select them, so opening a large monorepo stays fast.

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
- A non-skeleton `.json` sitting beside an atlas appears in the tree and reports an error when opened.
- Rendering currently targets Spine runtime assets compatible with `@esotericsoftware/spine-pixi-v8`.
- The extension expects atlas images to be local workspace files.

## License

This extension is MIT licensed. See `LICENSE`.

The bundled Spine Runtimes are licensed separately under the
[Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)
and require each user to hold a Spine Editor license. See `LICENSE-spine-runtimes.txt`.

Pixi.js is MIT licensed.
