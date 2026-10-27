import { rotateAround, type Vec3 } from '@/core';
import { TransformPointsCommand } from './pointDrag';
import type { ModelerState } from './state';

export type NumericOp =
  | { kind: 'move'; offset: Vec3 }
  /** Rotates about the world X, then Y, then Z axis through `pivot`; angles in degrees. */
  | { kind: 'rotate'; pivot: Vec3; degrees: Vec3 }
  /** Scales each axis separately about `pivot`. */
  | { kind: 'size'; pivot: Vec3; factors: Vec3 };

const LABELS = { move: 'Move', rotate: 'Rotate', size: 'Size' } as const;
const AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function transformer(op: NumericOp): (p: Vec3) => Vec3 {
  switch (op.kind) {
    case 'move':
      return (p) => [p[0] + op.offset[0], p[1] + op.offset[1], p[2] + op.offset[2]];
    case 'rotate':
      return (p) =>
        AXES.reduce((q, axis, i) => rotateAround(q, op.pivot, axis, (op.degrees[i]! * Math.PI) / 180), p);
    case 'size':
      return (p) => [
        op.pivot[0] + (p[0] - op.pivot[0]) * op.factors[0],
        op.pivot[1] + (p[1] - op.pivot[1]) * op.factors[1],
        op.pivot[2] + (p[2] - op.pivot[2]) * op.factors[2],
      ];
  }
}

/**
 * Apply an exact transform to the current selection (the whole object if nothing is selected) as one
 * undoable step. Returns false, recording nothing, if nothing would change.
 */
export function applyNumeric(state: ModelerState, op: NumericOp): boolean {
  const ids = state.affectedPoints();
  if (ids.length === 0) return false;
  const { mesh } = state;
  const before = ids.map((i) => [...mesh.points[i]!] as Vec3);
  const after = before.map(transformer(op));
  if (after.every((p, i) => p.every((c, axis) => c === before[i]![axis]))) return false;
  state.execute(new TransformPointsCommand(LABELS[op.kind], mesh, ids, before, after));
  return true;
}
