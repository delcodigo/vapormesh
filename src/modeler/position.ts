import type { Vec3 } from '@/core';
import type { EditResult } from './edit';
import { TransformPointsCommand } from './pointDrag';
import type { ModelerState } from './state';

export interface SelectionPosition {
  points: number;
  /** The point itself when one is selected, otherwise the centre of the box around them. */
  position: Vec3;
  /** Extent of the box around the selected points (zero for one point). */
  size: Vec3;
}

/** Where the selected points are, or null if none are selected. */
export function selectionPosition(state: ModelerState): SelectionPosition | null {
  const ids = state.selectedPointIds().filter((i) => i < state.mesh.points.length);
  if (ids.length === 0) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    state.mesh.points[id]!.forEach((c, k) => {
      lo[k] = Math.min(lo[k]!, c);
      hi[k] = Math.max(hi[k]!, c);
    });
  }
  return {
    points: ids.length,
    position: [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as Vec3,
    size: [0, 1, 2].map((k) => hi[k]! - lo[k]!) as Vec3,
  };
}

/**
 * Put the selection at `value` along one axis: a single point lands exactly there, several move together until the
 * centre of their box is there. One undo step. Acts on the selection only, never on the whole object.
 */
export function setSelectionPosition(state: ModelerState, axis: 0 | 1 | 2, value: number): EditResult {
  if (!Number.isFinite(value)) return { ok: false, message: 'Type a number for the position' };
  const ids = state.selectedPointIds();
  const now = selectionPosition(state);
  if (!now || ids.length === 0) return { ok: false, message: 'Select points to position' };
  const delta = value - now.position[axis];
  const before = ids.map((i) => [...state.mesh.points[i]!] as Vec3);
  // a single point is set exactly rather than as point + (value - point), which can differ in the last bit
  const after = before.map((p): Vec3 => {
    const q: Vec3 = [...p];
    q[axis] = ids.length === 1 ? value : p[axis] + delta;
    return q;
  });
  if (after.every((p, i) => p[axis] === before[i]![axis])) return { ok: false, message: 'That is where it already is' };
  state.execute(new TransformPointsCommand('Position', state.mesh, ids, before, after));
  return { ok: true, message: `Moved ${ids.length} point${ids.length === 1 ? '' : 's'}` };
}
