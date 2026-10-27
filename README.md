# VaporMesh

Authoring tools for making game assets and cutscene video with a mid-90s look, in the browser: low-poly meshes, flat and
Gouraud shading, a 256-colour palette, low-resolution dithered renders. The assets are meant for any engine (Unity, say); VaporMesh
is not an engine and has no runtime.

> Inspired by LightWave 3D. VaporMesh is an independent project and is not
> affiliated with or endorsed by NewTek or Vizrt.

## Status

The **Modeler** is the part that exists. The rest of the plan is in [`docs/SPEC.md`](docs/SPEC.md), with its order.

| Done | |
|------|---|
| Modeling | Box, ball, disc and cone; move, rotate, size and a numeric panel; extrude, bevel, mirror; stretch, drag, magnet, bend, twist, taper; knife; boolean between layers; select connected, grow, shrink, lasso, grid snap, hide; delete, merge, weld, flip, make polygon, triple; cut, copy and paste; ten layers |
| Surfaces and textures | Per-surface colour (from the palette), diffuse, luminosity, specular, smoothing and angle; indexed images, PNG import, per-corner UVs, a UV editor with projections |
| Palette | One 256-colour palette per project, a palette editor, `.gpl` and `.act` import and export, palettes from pictures |
| Look | A retro Shaded view: low resolution, nearest-neighbour upscaling, ordered dither, mapped to the project palette |
| Projects | Save and load `.vmesh` files, with undo for everything ([format](docs/FORMAT.md)) |

Not yet: the deformers (stretch, bend, twist, taper, magnet), the texture painter, glTF export, Layout and cutscenes, the animator, the tracker.

## Running it

```sh
npm install
npm run dev        # the editor, on http://localhost:5173
npm run typecheck  # tsc, including the tests
npm test           # unit tests (vitest)
npm run build      # typecheck + production build
```

It needs a browser with WebGL 2.

## Structure

| Path | Purpose |
|------|---------|
| `src/core` | The data model, with no rendering in it: meshes, surfaces, UVs, palettes, indexed images, colour conversion |
| `src/modeler` | Everything that edits a model: state, undo history, tools, geometry operations. Pure functions where possible, so they are testable |
| `src/render` | Three.js: the four viewports, the wireframe and shaded views, the retro post-process |
| `src/io` | The `.vmesh` project format |
| `src/ui` | The panels and dialogs, in the retro style |
| `src/layout` | Reserved for Layout (camera, lights, keyframes); empty for now |
| `docs/` | `SPEC.md` (what this is and the order it is built in) and `FORMAT.md` (the file format) |

`design/` holds reference screenshots and is deliberately not committed.
