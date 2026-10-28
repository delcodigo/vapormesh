import type { Vec3 } from '@/core';
import type { EditResult } from './edit';
import { TransformPointsCommand } from './pointDrag';
import type { ModelerState } from './state';

export interface Dimensions {
  /** What was measured: the selection, or the whole layer when nothing is selected. */
  ofSelection: boolean;
  points: number;
  polygons: number;
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

/** The size of the selection's box, or of the whole (visible) layer if nothing is selected. Null for an empty layer. */
export function measure(state: ModelerState): Dimensions | null {
  const { mesh } = state;
  const ofSelection = state.selection.size > 0;
  const ids = state.affectedPoints().filter((i) => i < mesh.points.length);
  if (ids.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    mesh.points[id]!.forEach((c, k) => {
      min[k] = Math.min(min[k]!, c);
      max[k] = Math.max(max[k]!, c);
    });
  }
  const used = new Set(ids);
  const polygons = mesh.polygons.filter((p, i) => !mesh.hidden.has(i) && p.points.every((pt) => used.has(pt))).length;
  return { ofSelection, points: ids.length, polygons, min, max, size: [0, 1, 2].map((k) => max[k]! - min[k]!) as Vec3 };
}

/**
 * Resize what `measure` measures so its box is `value` long on one axis, scaling about the centre of the box. With `uniform`
 * the other axes follow by the same factor. One undo step. Flat axes (size 0) cannot be scaled.
 */
export function setDimension(state: ModelerState, axis: 0 | 1 | 2, value: number, uniform = false): EditResult {
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: 'Type a size above zero' };
  const now = measure(state);
  if (!now) return { ok: false, message: 'Nothing to resize' };
  const current = now.size[axis];
  if (current === 0) return { ok: false, message: 'It is flat on that axis, so it has no size to scale' };
  const factor = value / current;
  if (factor === 1) return { ok: false, message: 'That is its size already' };
  const ids = state.affectedPoints();
  const centre = [0, 1, 2].map((k) => (now.min[k]! + now.max[k]!) / 2) as Vec3;
  const before = ids.map((i) => [...state.mesh.points[i]!] as Vec3);
  const after = before.map((p): Vec3 => p.map((c, k) => (k === axis || uniform ? centre[k]! + (c - centre[k]!) * factor : c)) as Vec3);
  state.execute(new TransformPointsCommand('Size', state.mesh, ids, before, after));
  return { ok: true, message: `Scaled ${ids.length} point${ids.length === 1 ? '' : 's'}` };
}
