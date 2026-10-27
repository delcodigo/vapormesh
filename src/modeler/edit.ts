import { boxProjectPolygon, DEFAULT_TEXTURE_SIZE, type Mesh, type Vec3 } from '@/core';
import { AddPrimitiveCommand } from './create';
import {
  cloneGeometry,
  deletePoints,
  deletePolygons,
  extractPolygons,
  findCoincident,
  flipPolygons,
  mergePoints,
  triangulate,
  type Geometry,
} from './geometry';
import type { Command } from './history';
import type { ModelerState } from './state';

/** What a command tells the person: whether it did something, and one line to show. */
export interface EditResult {
  ok: boolean;
  message: string;
}
const fail = (message: string): EditResult => ({ ok: false, message });
const done = (message: string): EditResult => ({ ok: true, message });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Points within this distance are the same point to Merge Points. */
export const MERGE_TOLERANCE = 0.0001;

interface Selection {
  points: number[];
  polygons: number[];
}
const snapshotSelection = (state: ModelerState): Selection => ({ points: [...state.selectedPoints], polygons: [...state.selectedPolygons] });
function restoreSelection(state: ModelerState, s: Selection): void {
  state.selectedPoints.clear();
  state.selectedPolygons.clear();
  s.points.forEach((i) => state.selectedPoints.add(i));
  s.polygons.forEach((i) => state.selectedPolygons.add(i));
}

/**
 * Replace the points and polygons of a layer. The numbering of points and polygons changes, so this keeps whole
 * snapshots (not a delta) and puts the selection back with them.
 */
export class ReplaceGeometryCommand implements Command {
  private mesh: Mesh;
  private before: Geometry;
  private after: Geometry;
  private selectionBefore: Selection;

  constructor(
    readonly label: string,
    private state: ModelerState,
    after: Geometry,
    private selectionAfter: Selection,
  ) {
    this.mesh = state.mesh;
    this.before = cloneGeometry(this.mesh);
    this.after = cloneGeometry(after);
    this.selectionBefore = snapshotSelection(state);
  }

  redo(): void {
    this.apply(this.after, this.selectionAfter);
  }

  undo(): void {
    this.apply(this.before, this.selectionBefore);
  }

  private apply(geo: Geometry, selection: Selection): void {
    const copy = cloneGeometry(geo); // never hand out the stored arrays: later edits would change history
    this.mesh.points = copy.points;
    this.mesh.polygons = copy.polygons;
    restoreSelection(this.state, selection);
  }
}

const geometryOf = (state: ModelerState): Geometry => state.mesh;
const noSelection: Selection = { points: [], polygons: [] };

/** Polygons an operation acts on: the selected ones, or every polygon if none are selected. */
const targetPolygons = (state: ModelerState): number[] => {
  const picked = state.selectedPolygonIds();
  return picked.length ? picked : state.mesh.polygons.map((_, i) => i);
};

// --- delete / merge / weld ---------------------------------------------------------------------------------------

/** In Point mode, delete the selected points and the polygons that use them; in Polygon mode, delete the selected polygons. */
export function deleteSelection(state: ModelerState, label = 'Delete'): EditResult {
  const { mesh, mode } = state;
  if (state.selection.size === 0) return fail(`Select ${mode === 'points' ? 'points' : 'polygons'} to delete`);
  const before = { points: mesh.points.length, polygons: mesh.polygons.length };
  const geometry = mode === 'points' ? deletePoints(geometryOf(state), state.selectedPoints) : deletePolygons(geometryOf(state), state.selectedPolygons);
  state.execute(new ReplaceGeometryCommand(label, state, geometry, noSelection));
  const [dp, dq] = [before.points - geometry.points.length, before.polygons - geometry.polygons.length];
  return done(`${label === 'Cut' ? 'Cut' : 'Deleted'} ${plural(dq, 'polygon')} and ${plural(dp, 'point')}`);
}

/** Merge points that sit on top of each other (within MERGE_TOLERANCE). Uses the selected points, or all if none are selected. */
export function mergeCoincidentPoints(state: ModelerState, tolerance = MERGE_TOLERANCE): EditResult {
  const { mesh } = state;
  const ids = state.selectedPoints.size ? [...state.selectedPoints] : mesh.points.map((_, i) => i);
  const mapping = findCoincident(mesh.points, ids, tolerance);
  const merged = mapping.filter((m, i) => m !== i).length;
  if (merged === 0) return fail('No points are close enough to merge');
  const geometry = mergePoints(geometryOf(state), mapping);
  state.execute(new ReplaceGeometryCommand('Merge Points', state, geometry, noSelection));
  return done(`Merged ${plural(merged, 'point')}`);
}

/** Weld the selected points into one, at their average position. */
export function weldSelection(state: ModelerState): EditResult {
  const ids = [...state.selectedPoints].sort((a, b) => a - b);
  if (ids.length < 2) return fail('Select at least two points to weld');
  const { mesh } = state;
  const target = ids[0]!;
  const center: Vec3 = [0, 1, 2].map((k) => ids.reduce((s, i) => s + mesh.points[i]![k]!, 0) / ids.length) as Vec3;
  const geo = cloneGeometry(geometryOf(state));
  geo.points[target] = center;
  const mapping = geo.points.map((_, i) => i);
  for (const i of ids) mapping[i] = target;
  const geometry = mergePoints(geo, mapping);
  // the target is the lowest selected point, so nothing before it was removed and it keeps its number
  state.execute(new ReplaceGeometryCommand('Weld', state, geometry, { points: [target], polygons: [] }));
  return done(`Welded ${ids.length} points into one`);
}

// --- flip / make / triple -----------------------------------------------------------------------------------------

/** Turn the selected polygons (or all, if none are selected) inside out. */
export function flipSelection(state: ModelerState): EditResult {
  const ids = targetPolygons(state);
  if (ids.length === 0) return fail('There are no polygons to flip');
  const geometry = flipPolygons(geometryOf(state), new Set(ids));
  state.execute(new ReplaceGeometryCommand('Flip', state, geometry, snapshotSelection(state)));
  return done(`Flipped ${plural(ids.length, 'polygon')}`);
}

/**
 * Make one polygon from the selected points, joined in the order they were selected (click them one after another,
 * with Shift). They run counter-clockwise seen from the front. It gets the first surface and box-projected UVs.
 */
export function makePolygon(state: ModelerState): EditResult {
  const ids = [...state.selectedPoints];
  if (ids.length < 3) return fail('Select at least three points, in order, to make a polygon');
  const { mesh } = state;
  const surface = mesh.surfaces[0];
  const texture = state.images.find((i) => i.name === surface?.texture);
  const size = [texture?.width ?? DEFAULT_TEXTURE_SIZE, texture?.height ?? DEFAULT_TEXTURE_SIZE] as const;
  const geo = cloneGeometry(geometryOf(state));
  geo.polygons.push({ points: ids, surface: 0, uvs: boxProjectPolygon(ids.map((i) => mesh.points[i]!), ...size) });
  state.execute(new ReplaceGeometryCommand('Make Polygon', state, geo, { points: ids, polygons: [geo.polygons.length - 1] }));
  return done(`Made a polygon from ${ids.length} points`);
}

/** Split the selected polygons (or all, if none are selected) into triangles. */
export function triangulateSelection(state: ModelerState): EditResult {
  const ids = targetPolygons(state);
  const big = ids.filter((i) => state.mesh.polygons[i]!.points.length > 3);
  if (big.length === 0) return fail('Every polygon is already a triangle');
  const { geometry, selected } = triangulate(geometryOf(state), new Set(ids));
  state.execute(new ReplaceGeometryCommand('Triple', state, geometry, { points: [...state.selectedPoints], polygons: selected }));
  return done(`Split ${plural(big.length, 'polygon')} into triangles`);
}

// --- clipboard ------------------------------------------------------------------------------------------------------

/** Copy the selected polygons (in Point mode, those whose points are all selected) to the clipboard. */
export function copySelection(state: ModelerState): EditResult {
  const ids = state.selectedPolygonIds();
  if (ids.length === 0) return fail('Select polygons to copy');
  state.setClipboard(extractPolygons(state.mesh, ids));
  return done(`Copied ${plural(ids.length, 'polygon')}`);
}

/** Copy, then delete. */
export function cutSelection(state: ModelerState): EditResult {
  const ids = state.selectedPolygonIds();
  if (ids.length === 0) return fail('Select polygons to cut');
  state.setClipboard(extractPolygons(state.mesh, ids));
  // cutting removes the polygons themselves, whichever mode was used to pick them
  const geometry = deletePolygons(geometryOf(state), new Set(ids));
  state.execute(new ReplaceGeometryCommand('Cut', state, geometry, noSelection));
  return done(`Cut ${plural(ids.length, 'polygon')}`);
}

/** Add the clipboard to the active layer where it was copied from, and select it. */
export function pasteClipboard(state: ModelerState): EditResult {
  const clip = state.clipboard;
  if (!clip || clip.polygons.length === 0) return fail('The clipboard is empty');
  const before = state.mesh.size();
  state.execute(new AddPrimitiveCommand(state, clip, state.activeLayer, 'Paste'));
  const count = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  state.applySelection(state.mode === 'points' ? count(before.points, state.mesh.points.length) : count(before.polygons, state.mesh.polygons.length), 'replace');
  return done(`Pasted ${plural(clip.polygons.length, 'polygon')}`);
}
