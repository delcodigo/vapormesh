# VaporMesh

A TypeScript/WebGL 3D modeler and layout tool in the spirit of mid-90s desktop
3D software, built for making graphics in that style: low-poly meshes, flat and
Gouraud shading, low-res renders, affine textures, vertex snapping, and a
vaporwave look by default.

> Inspired by LightWave 3D. VaporMesh is an independent project and is not
> affiliated with or endorsed by NewTek or Vizrt.

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
