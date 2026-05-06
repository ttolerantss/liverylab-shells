# LiveryLab Shells

A Windows desktop tool that extracts paint-only bodyshells from GTA V vehicle `.yft.xml` files and exports them as clean `.obj` meshes — part of the [LiveryLab](https://liverylab.cc) toolchain.

Drop a YFT XML (CodeWalker / OpenIV export) on the window, click extract, get a `{name}_bodyshell.obj` containing only the painted body — no windows, no lights, no interior, no decals. The resulting OBJ is the foundation mesh for livery preview pipelines like [livery-viewer](https://github.com/ttolerantss/liverylab-repaint).

## Features

- **Drag-and-drop** or browse to select a `.yft.xml` file
- **Highest-LOD only** — automatically picks `DrawableModelsHigh`, falls back to Med/Low/VeryLow if needed
- **Top-level drawable only** — child fragments (damage / breakable parts) are skipped
- **Editable paint shader whitelist** — defaults cover all stock GTA paint slots; add or remove names as needed
- **Y-up output** — converts from GTA's native Z-up so the OBJ lands cleanly in Blender / glTF / Three.js
- **Per-chunk groups** — surviving geometries are grouped (`g paint1`, `g paint2`, …) so they're easy to identify in modeling software
- **Safe writes** — auto-renames `(1)`, `(2)`, etc. instead of overwriting an existing file

## Default paint shader whitelist

```
vehicle_paint, vehicle_paint_generic,
vehicle_paint1, vehicle_paint2, vehicle_paint3, vehicle_paint4,
vehicle_paint5, vehicle_paint6, vehicle_paint7, vehicle_paint8, vehicle_paint9
```

The whitelist is editable inside the **Paint shader whitelist** disclosure section in the UI. `.sps` is stripped automatically and matching is case-insensitive.

## Workflow

```
CodeWalker -> .yft.xml -> LiveryLab Shells -> .obj -> (Blender) -> .glb -> livery-viewer
```

## Installation

### From Release

Download the latest `LiveryLab Shells Setup <version>.exe` from the [Releases](https://github.com/ttolerantss/liverylab-shells/releases) page and run it.

### From Source

```bash
git clone https://github.com/ttolerantss/liverylab-shells.git
cd liverylab-shells
npm install
npm start
```

### Build Executable

```bash
npm run build       # NSIS installer in dist/
npm run build:dir   # Unpacked .exe in dist/win-unpacked/
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | [Electron](https://www.electronjs.org/) |
| XML parsing | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) |
| Bundler | [esbuild](https://esbuild.github.io/) |
| Installer | [electron-builder](https://www.electron.build/) (NSIS) |

## Project Structure

```
liverylab-shells/
  src/
    main/main.js              Electron main process (window, IPC, parse/write orchestration)
    renderer/
      index.html              UI markup + LiveryLab design tokens
      renderer.js             UI logic (drag/drop, options, IPC calls)
    lib/
      shaders.js              Default paint shader whitelist
      yft-parser.js           XML -> geometry chunks
      obj-writer.js           geometry chunks -> OBJ file
    assets/                   Logo + branding (shared with the LiveryLab family)
  package.json
```

## Notes

- Vertex format is read from each geometry's `<Layout type="GTAV1">` block; positions, normals, and TexCoord0 are emitted to the OBJ when present.
- `vehicle_paint_fd` is intentionally **not** in the default whitelist — it's a custom 4-channel paint variant. Add it manually in the UI if you need it.
- This is a personal tool — no telemetry, no cloud features, no licensing.

## Related Projects

- [LiveryLab Repaint](https://github.com/ttolerantss/liverylab-repaint) — live PSD livery preview on 3D vehicle models
- [LiveryLab Export](https://github.com/ttolerantss/psd-exporter) — color-coded PSD layer variant exporter

## License

ISC
