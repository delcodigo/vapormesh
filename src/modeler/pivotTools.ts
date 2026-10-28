import { rotateAround, type Vec3 } from '@/core';
import { PointDrag, type DragMove, type ViewInfo } from './pointDrag';
import { snapFactor } from './selectTools';
import type { ModelerState } from './state';

/** Pixels around the pivot within which the Size tool treats the cursor as this far away. */
const MIN_SIZE_RADIUS = 16;
const MIN_SCALE = 0.001;

/** Shared pivot capture: the manual pivot or the centre of the affected points, held fixed for the whole drag. */
abstract class PivotDrag extends PointDrag {
  protected pivot: Vec3 = [0, 0, 0];
  protected pivotScreen = { x: 0, y: 0 };
  protected axis: Vec3 = [0, 0, 1];

  protected override start(view: ViewInfo): boolean {
    const center = this.state.pivotFor(this.ids);
    if (!center) return false;
    this.pivot = center;
    this.state.dragPivot = center;
    this.pivotScreen = view.project(center);
    this.axis = view.viewAxis;
    return true;
  }
}

const DEGREES_PER_PIXEL = 0.5;

/**
 * Rotates about the axis pointing out of the view, by the angle the cursor sweeps around the pivot. With exactly one axis locked it
 * turns about that axis instead: swept around the pivot if the axis points out of the view, otherwise by how far the cursor
 * moves across the axis as drawn.
 */
export class RotateTool extends PivotDrag {
  constructor(state: ModelerState) {
    super(state, 'Rotate');
  }

  private about: Vec3 | null = null;
  private across = { x: 0, y: 0 };

  protected override start(view: ViewInfo): boolean {
    if (!super.start(view)) return false;
    this.about = null;
    this.across = { x: 0, y: 0 };
    const locked = this.state.lockedAxes();
    if (locked.length !== 1) return true;
    const axis: Vec3 = [0, 0, 0];
    axis[locked[0]!] = 1;
    const along = axis[0] * this.axis[0] + axis[1] * this.axis[1] + axis[2] * this.axis[2];
    if (Math.abs(along) > 0.5) {
      this.about = axis;
      if (along < 0) this.about = axis.map((c) => -c) as Vec3;
      return true;
    }
    // the axis lies in the view: the cursor turns the object by crossing it
    const tip = view.project([this.pivot[0] + axis[0], this.pivot[1] + axis[1], this.pivot[2] + axis[2]]);
    const dx = tip.x - this.pivotScreen.x;
    const dy = tip.y - this.pivotScreen.y;
    const len = Math.hypot(dx, dy) || 1;
    this.about = axis;
    this.across = { x: -dy / len, y: dx / len };
    return true;
  }

  move({ start, current }: DragMove): void {
    if (this.about && (this.across.x !== 0 || this.across.y !== 0)) {
      const crossed = (current.x - start.x) * this.across.x + (current.y - start.y) * this.across.y;
      const turn = (crossed * DEGREES_PER_PIXEL * Math.PI) / 180;
      const about = this.about;
      this.transform((p) => rotateAround(p, this.pivot, about, turn));
      return;
    }
    const { x, y } = this.pivotScreen;
    // Screen y points down, so a clockwise sweep is a positive screen angle but a negative world angle.
    const angle = Math.atan2(start.y - y, start.x - x) - Math.atan2(current.y - y, current.x - x);
    this.transform((p) => rotateAround(p, this.pivot, this.about ?? this.axis, angle));
  }
}

/** Scales about the pivot (on the locked axes only, if any) by the ratio of the cursor's distance from it now vs. at the press. */
export class SizeTool extends PivotDrag {
  constructor(state: ModelerState) {
    super(state, 'Size');
  }

  move({ start, current }: DragMove): void {
    const { x, y } = this.pivotScreen;
    const radius = (p: { x: number; y: number }) => Math.max(Math.hypot(p.x - x, p.y - y), MIN_SIZE_RADIUS);
    const f = snapFactor(Math.max(radius(current) / radius(start), MIN_SCALE), this.state.snap);
    const c = this.pivot;
    const locked = this.state.lockedAxes();
    const by = (k: number) => (locked.length === 0 || locked.includes(k) ? f : 1);
    this.transform((p): Vec3 => [c[0] + (p[0] - c[0]) * by(0), c[1] + (p[1] - c[1]) * by(1), c[2] + (p[2] - c[2]) * by(2)]);
  }
}
