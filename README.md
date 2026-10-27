# WebWave 3D

A TypeScript/WebGL take on mid-90s LightWave 3D (v4/v5 era): a Modeler and a
Layout in the browser, with a deliberately retro render pipeline (flat/Gouraud
shading, low-res, affine textures, vertex snapping, scanline-era effects).

## Structure

| Path | Purpose |
|------|---------|
| `src/core` | Renderer-agnostic data model: meshes (points/polygons/surfaces), scene graph, items, envelopes/keyframes, undo |
| `src/modeler` | Modeling tools and commands (primitives, extrude, bevel, boolean, ...) operating on `core` meshes |
| `src/layout` | Scene composition: items, camera, lights, motion/timeline, hierarchy |
| `src/render` | Three.js viewports and the retro final-render pipeline |
| `src/io` | File formats: LWO (objects), LWS (scenes), native JSON project format |
| `src/ui` | Retro-styled UI: panels, menus, viewport layout |

## Scripts

- `npm run dev` – dev server
- `npm run build` – typecheck + production build
- `npm test` – unit tests (vitest)
