import type { Mesh, Vec3 } from '@/core';
import type { EditResult } from './edit';
import type { ModelerState } from './state';

const fail = (message: string): EditResult => ({ ok: false, message });
const done = (message: string): EditResult => ({ ok: true, message });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Polygon ids that use each point, ignoring hidden polygons. */
function polygonsAtPoints(mesh: Mesh): Map<number, number[]> {
  const at = new Map<number, number[]>();
  mesh.polygons.forEach((poly, pi) => {
    if (mesh.hidden.has(pi)) return;
    for (const p of poly.points) {
      const list = at.get(p);
      if (list) list.push(pi);
      else at.set(p, [pi]);
    }
  });
  return at;
}

/** Everything reachable from the seed points through shared polygons: the pieces of geometry the seeds belong to. */
export function connectedPoints(mesh: Mesh, seeds: Iterable<number>): Set<number> {
  const at = polygonsAtPoints(mesh);
  const points = new Set<number>(seeds);
  const donePolygons = new Set<number>();
  const queue = [...points];
  while (queue.length) {
    for (const pi of at.get(queue.pop()!) ?? []) {
      if (donePolygons.has(pi)) continue;
      donePolygons.add(pi);
      for (const p of mesh.polygons[pi]!.points) if (!points.has(p)) (points.add(p), queue.push(p));
    }
  }
  return points;
}

/** The polygons of the pieces of geometry the seed polygons belong to. Polygons that only touch at a point count as joined. */
export function connectedPolygons(mesh: Mesh, seeds: Iterable<number>): Set<number> {
  const at = polygonsAtPoints(mesh);
  const polygons = new Set<number>();
  const queue: number[] = [];
  for (const s of seeds) if (!mesh.hidden.has(s) && !polygons.has(s)) (polygons.add(s), queue.push(s));
  while (queue.length) {
    for (const p of mesh.polygons[queue.pop()!]!.points) {
      for (const pi of at.get(p) ?? []) if (!polygons.has(pi)) (polygons.add(pi), queue.push(pi));
    }
  }
  return polygons;
}

/** Points that share a polygon with a selected point, added to it. */
export function growPoints(mesh: Mesh, selected: Set<number>): Set<number> {
  const out = new Set(selected);
  mesh.polygons.forEach((poly, pi) => {
    if (!mesh.hidden.has(pi) && poly.points.some((p) => selected.has(p))) poly.points.forEach((p) => out.add(p));
  });
  return out;
}

/** The selection without its outer layer: points that share a polygon with a point that is not selected. */
export function shrinkPoints(mesh: Mesh, selected: Set<number>): Set<number> {
  const out = new Set(selected);
  mesh.polygons.forEach((poly, pi) => {
    if (!mesh.hidden.has(pi) && poly.points.some((p) => !selected.has(p))) poly.points.forEach((p) => out.delete(p));
  });
  return out;
}

/** Polygons that touch a selected polygon at a point, added to it. */
export function growPolygons(mesh: Mesh, selected: Set<number>): Set<number> {
  const at = polygonsAtPoints(mesh);
  const out = new Set(selected);
  for (const pi of selected) for (const p of mesh.polygons[pi]?.points ?? []) for (const n of at.get(p) ?? []) out.add(n);
  return out;
}

/** The selection without its outer layer: polygons that touch a polygon that is not selected. */
export function shrinkPolygons(mesh: Mesh, selected: Set<number>): Set<number> {
  const at = polygonsAtPoints(mesh);
  const out = new Set(selected);
  for (const pi of selected) {
    if (mesh.polygons[pi]!.points.some((p) => (at.get(p) ?? []).some((n) => !selected.has(n)))) out.delete(pi);
  }
  return out;
}

const replace = (state: ModelerState, ids: Set<number>) => state.applySelection(ids, 'replace');

/** Extend the selection to everything joined to it. */
export function selectConnected(state: ModelerState): EditResult {
  if (state.selection.size === 0) return fail(`Select a ${state.mode === 'points' ? 'point' : 'polygon'} to start from`);
  const { mesh } = state;
  const before = state.selection.size;
  const ids = state.mode === 'points' ? connectedPoints(mesh, state.selection) : connectedPolygons(mesh, state.selection);
  replace(state, ids);
  return done(`Selected ${plural(ids.size, state.mode === 'points' ? 'point' : 'polygon')}${ids.size === before ? ' (already everything joined)' : ''}`);
}

export function growSelection(state: ModelerState): EditResult {
  if (state.selection.size === 0) return fail('Select something to grow');
  const { mesh } = state;
  const ids = state.mode === 'points' ? growPoints(mesh, state.selection) : growPolygons(mesh, state.selection);
  if (ids.size === state.selection.size) return fail('The selection cannot grow any further');
  replace(state, ids);
  return done(`Selected ${plural(ids.size, state.mode === 'points' ? 'point' : 'polygon')}`);
}

export function shrinkSelection(state: ModelerState): EditResult {
  if (state.selection.size === 0) return fail('Select something to shrink');
  const { mesh } = state;
  const ids = state.mode === 'points' ? shrinkPoints(mesh, state.selection) : shrinkPolygons(mesh, state.selection);
  if (ids.size === state.selection.size) return fail('The selection has no edge to shrink from');
  if (ids.size === 0) return fail('Shrinking would leave nothing selected');
  replace(state, ids);
  return done(`Selected ${plural(ids.size, state.mode === 'points' ? 'point' : 'polygon')}`);
}

// --- hide / unhide ---------------------------------------------------------------------------------------------------

/** Polygons that the selection stands for: the selected ones, or those whose points are all selected. */
function selectedPolygonSet(state: ModelerState): Set<number> {
  return new Set(state.selectedPolygonIds().filter((pi) => !state.mesh.hidden.has(pi)));
}

/** Take hidden things out of the selection. */
function dropHiddenFromSelection(state: ModelerState): void {
  const { mesh } = state;
  const hiddenPoints = mesh.hiddenPoints();
  for (const p of hiddenPoints) state.selectedPoints.delete(p);
  for (const pi of mesh.hidden) state.selectedPolygons.delete(pi);
}

/** Hide the selected polygons (in Point mode, the polygons whose points are all selected), or with `unselected` everything else. */
export function hideSelection(state: ModelerState, unselected = false): EditResult {
  const { mesh } = state;
  const chosen = selectedPolygonSet(state);
  if (chosen.size === 0) return fail(state.mode === 'points' ? 'Select points that make up whole polygons to hide' : 'Select polygons to hide');
  const targets = unselected ? mesh.polygons.flatMap((_, i) => (chosen.has(i) || mesh.hidden.has(i) ? [] : [i])) : [...chosen];
  if (targets.length === 0) return fail('Nothing else to hide');
  targets.forEach((i) => mesh.hidden.add(i));
  dropHiddenFromSelection(state);
  state.changed();
  return done(`Hid ${plural(targets.length, 'polygon')}`);
}

export function unhideAll(state: ModelerState): EditResult {
  const { mesh } = state;
  if (mesh.hidden.size === 0) return fail('Nothing is hidden');
  const n = mesh.hidden.size;
  mesh.hidden.clear();
  state.changed();
  return done(`Showed ${plural(n, 'polygon')}`);
}

// --- layers -----------------------------------------------------------------------------------------------------------

/** Hide or show one layer. The layer you are editing cannot be hidden. */
export function toggleLayerHidden(state: ModelerState, layer: number): EditResult {
  const hide = !state.isLayerHidden(layer);
  if (!state.setLayerHidden(layer, hide)) {
    return fail(layer === state.activeLayer ? 'This is the layer you are editing; go to another layer to hide it' : 'There is no such layer');
  }
  return done(`${hide ? 'Hid' : 'Showed'} layer ${layer + 1}`);
}

/** Hide every layer but the active one: look at one thing on its own. */
export function soloLayer(state: ModelerState): EditResult {
  const others = state.layers.flatMap((l, i) => (i !== state.activeLayer && l.points.length > 0 && !state.isLayerHidden(i) ? [i] : []));
  if (others.length === 0) return fail('There are no other layers with anything in them to hide');
  others.forEach((i) => state.setLayerHidden(i, true));
  return done(`Hid ${plural(others.length, 'other layer')}`);
}

export function showAllLayers(state: ModelerState): EditResult {
  const hidden = [...state.hiddenLayers];
  if (hidden.length === 0) return fail('No layers are hidden');
  hidden.forEach((i) => state.setLayerHidden(i, false));
  return done(`Showed ${plural(hidden.length, 'layer')}`);
}

/**
 * The H key: hide what is selected; with nothing selected, show everything that is hidden (polygons first, then layers).
 * One key to put things away and bring them back.
 */
export function toggleHidden(state: ModelerState): EditResult {
  if (state.selectedPolygonIds().length > 0) return hideSelection(state);
  if (state.mesh.hidden.size > 0) return unhideAll(state);
  if (state.hiddenLayers.size > 0) return showAllLayers(state);
  return fail('Select something to hide');
}

// --- grid snapping ---------------------------------------------------------------------------------------------------

/** Round `value` to the nearest multiple of `grid`, or leave it alone when the grid is 0. */
export const snapValue = (value: number, grid: number): number => (grid > 0 ? Math.round(value / grid) * grid : value);

/** Snap a scale factor to whole grid steps (1.0, 1.1, 1.2 ... for 0.1), never below one step so nothing collapses. */
export const snapFactor = (factor: number, grid: number): number => (grid > 0 ? Math.max(snapValue(factor, grid), grid) : factor);

/** Snap a world-space drag offset to whole grid steps, so moved points keep their place relative to the grid. */
export function snapOffset(offset: Vec3, grid: number): Vec3 {
  return [snapValue(offset[0], grid) + 0, snapValue(offset[1], grid) + 0, snapValue(offset[2], grid) + 0];
}

/** Snap a point's position to the grid on the axes of the view plane; the depth axis is left as it was. */
export function snapPointInView(p: Vec3, grid: number, viewAxis: Vec3): Vec3 {
  return [0, 1, 2].map((k) => (Math.abs(viewAxis[k]!) > 0.5 ? p[k]! : snapValue(p[k]!, grid) + 0)) as Vec3;
}
