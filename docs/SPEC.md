# VaporMesh spec (draft v2, 2026-10-27)

VaporMesh is a set of authoring tools that make mid-90s-style game assets and cutscene video. It is not an
engine and not a game runtime. Games are built elsewhere (Unity or any other engine) from what these tools export.

Status of each item: **Decided** (by the author), **Proposed** (a default, change freely), **Open**.

## Decided

- **Five tools**, each enforcing the same 1995 constraints and exporting standard formats:
  1. **Modeler**: LightWave-style polygon modeling (built).
  2. **Texture editor**: Deluxe Paint-style, palette-based.
  3. **Animator**: keyframed object animation for game assets.
  4. **Layout**: composes scenes with camera and lights and renders **cutscenes as video**.
  5. **Tracker**: music, in a standard module format.
- **UV editing is a first-class feature.** UVs are stored **per polygon corner**, so one atlas texture can
  serve a whole model (a character with many parts) or each face can have its own texture, as some
  mid-90s games did. A texture belongs to a **surface**; surfaces may share an image. There is a 2D UV
  editor with projections, texel snapping and the same move/rotate/size tools as the Modeler.
- **For the author, in the browser.** One app with a tab per tool, in the LightWave 4 manner.
- **Engines are someone else's job.** Engine support, if any, comes later as small plugins or libraries.
- The constraints exist to keep assets in the period look and to keep the tools small.

## Proposed constraints (one shared profile)

| Area | Proposal |
|------|----------|
| Resolution | 320x240 default for renders and video, up to 640x480 |
| Colour | One editable 256-colour palette per project, shared by the texture editor, Modeler preview and Layout renders |
| Textures | Indexed, power-of-two sides 8 to 256, default 64x64 |
| Models | Triangulated at export; flat or Gouraud per surface; single-sided by default; polygon budget warning |
| Animation | Rigid hierarchical part transforms plus vertex-morph frames; no skinned skeletons in v1 |
| Video | Low resolution, palette-mapped with ordered dither, 15 or 30 fps |
| Music | Standard tracker modules (XM or MOD), 8-bit samples, a limited channel count |

## Proposed exports

| Tool | Export |
|------|--------|
| Modeler, Animator | glTF (.glb) with UVs, surfaces and animation; OBJ as a fallback |
| Texture editor | Indexed PNG, plus the palette as .gpl and .act |
| Layout | WebM or MP4 video, plus PNG sequences |
| Tracker | The module itself, plus a WAV render |
| All | `.vmesh` project files for editing in VaporMesh |

## Engine side (later)

The retro look in a game comes from low resolution, palette mapping, dither and optional affine texturing or
vertex snapping. Constrained assets alone won't give it. The one library worth building is a **post-process
and shader pack** (Unity first) that reproduces the Modeler's retro pass.

## Parked (decided against, for now)

A runtime and game export, a Quake-style brush map editor, entities, an in-app code editor. One idea
survives: **automatic texture coordinates at a fixed texel density** (box projection) as a Modeler feature.

## Open

1. Animator vs Layout: is the Animator for game-asset animation clips, with Layout for cutscenes?
2. Animation style: rigid parts plus morphs (proposed) or bones?
3. Palette: one global 256-colour palette as proposed?
4. Music format: XM or MOD?
5. Video container and encoder (WebCodecs).

## Order (proposed)

Done: palette and indexed images with per-corner UVs and surface textures (file format v2), PNG import, the UV
editor, the palette editor; core editing (delete, merge points, weld, flip, make polygon, triple, cut/copy/paste);
extrude, bevel, array/clone, lathe, mirror, the knife and boolean (add, subtract, intersect between layers); the deformers (stretch, drag,
magnet, bend, twist, taper), each by dragging in a view or by typed values; selection and display (select connected,
grow/shrink, lasso, grid snapping for Move and Drag, hide/unhide; hiding is display state: it is not saved and a
structural edit unhides).

Next, in this order, until the Modeler can build a prop or a character:

1. The rest of the Multiply family: smooth shift. (Added after the fact; deliberately after the
   items above, which were agreed first.)

Then:

2. Texture editor: pixel painting on indexed images (the palette editor is already done).
3. glTF export, so assets can be tried in Unity early.
4. Layout: camera, lights, keyframes, then video and PNG export.
5. Animator.
6. Tracker, any time.
