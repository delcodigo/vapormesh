import { rotateAround, type Vec3 } from '@/core';
import { PointDrag, type DragMove, type ViewInfo } from './pointDrag';
import type { ModelerState } from './state';

/** Pixels around the pivot within which the Size tool treats the cursor as this far away. */
const MIN_SIZE_RADIUS = 16;
const MIN_SCALE = 0.001;

/** Shared pivot capture: the centre of the affected points, held fixed for the whole drag. */
abstract class PivotDrag extends PointDrag {
  protected pivot: Vec3 = [0, 0, 0];
  protected pivotScreen = { x: 0, y: 0 };
  protected axis: Vec3 = [0, 0, 1];

  protected override start(view: ViewInfo): boolean {
    const center = this.state.centerOf(this.ids);
    if (!center) return false;
    this.pivot = center;
    this.state.dragPivot = center;
    this.pivotScreen = view.project(center);
    this.axis = view.viewAxis;
    return true;
  }
}

/** Rotates about the axis pointing out of the view, by the angle the cursor sweeps around the pivot. */
export class RotateTool extends PivotDrag {
  constructor(state: ModelerState) {
    super(state, 'Rotate');
  }

  move({ start, current }: DragMove): void {
    const { x, y } = this.pivotScreen;
    // Screen y points down, so a clockwise sweep is a positive screen angle but a negative world angle.
    const angle = Math.atan2(start.y - y, start.x - x) - Math.atan2(current.y - y, current.x - x);
    this.transform((p) => rotateAround(p, this.pivot, this.axis, angle));
  }
}

/** Scales uniformly about the pivot by the ratio of the cursor's distance from it now vs. at the press. */
export class SizeTool extends PivotDrag {
  constructor(state: ModelerState) {
    super(state, 'Size');
  }

  move({ start, current }: DragMove): void {
    const { x, y } = this.pivotScreen;
    const radius = (p: { x: number; y: number }) => Math.max(Math.hypot(p.x - x, p.y - y), MIN_SIZE_RADIUS);
    const f = Math.max(radius(current) / radius(start), MIN_SCALE);
    const c = this.pivot;
    this.transform((p): Vec3 => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, c[2] + (p[2] - c[2]) * f]);
  }
}
