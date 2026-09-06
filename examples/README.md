# Example Spine Assets

Seven small skeletons used for screenshots and for trying the extension without a real project.

Open this repository in VS Code and the Spine Viewer sidebar will list them:

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

The layout is deliberate. It covers the cases the sidebar tree has to handle:

- Two different skeletons named `coin`, so the tree has to keep them apart.
- `hero/hero.json` and `parrot/parrot.json` sit alone in a folder named after them, which the
  tree folds into a single row.
- `space-game/.../ui` holds one skeleton whose name differs from the folder, so the folder name
  is kept in the label as `ui / coin`.

The art is plain geometry, drawn by a generator rather than exported from the Spine editor. It is
here to exercise the viewer, not to look good. These files are not shipped in the extension
package.
