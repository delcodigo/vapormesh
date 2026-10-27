import type { Vec3 } from '@/core';
import { deformer, magnet, magnetWeight, type DeformAxis, type DeformSpec } from './deform';
import { PointDrag, type DragMove, type ViewInfo } from './pointDrag';
import type { ModelerState } from './state';

/** Pixels around the pivot within which Stretch treats the cursor as this far away. */
const MIN_STRETCH_RADIUS = 16;
const MIN_SCALE = 0.001;
/** How close (in pixels) a press must be to a point for the Drag tool to grab it. */
const GRAB_RADIUS = 12;

export interface AxisDeformSettings {
  axis: DeformAxis;
  /** Bend only: the axis the bar curves towards. */
  toward: DeformAxis;
}

/** Drag amounts: how much of each effect one pixel of horizontal drag gives. */
export const TAPER_PER_PIXEL = 1 / 200;
export const TWIST_DEGREES_PER_PIXEL = 1;
export const BEND_DEGREES_PER_PIXEL = 0.75;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Taper, Twist and Bend: the amount follows the horizontal drag, the axis comes from the tool's options. */
export class AxisDeformTool extends PointDrag {
  private pivot: Vec3 = [0, 0, 0];

  constructor(
    state: ModelerState,
    private kind: 'taper' | 'twist' | 'bend',
    private settings: () => AxisDeformSettings,
    label: string,
  ) {
    super(state, label);
  }

  protected override start(): boolean {
    const center = this.state.pivotFor(this.ids);
    if (!center) return false;
    this.pivot = center;
    this.state.dragPivot = center;
    return true;
  }

  move({ start, current }: DragMove): void {
    const dx = current.x - start.x;
    const { axis, toward } = this.settings();
    const spec: DeformSpec =
      this.kind === 'taper'
        ? { kind: 'taper', axis, amount: dx * TAPER_PER_PIXEL }
        : this.kind === 'twist'
          ? { kind: 'twist', axis, radians: radians(dx * TWIST_DEGREES_PER_PIXEL) }
          : { kind: 'bend', axis, toward, radians: radians(dx * BEND_DEGREES_PER_PIXEL) };
    this.transform(deformer(this.before, spec, this.pivot));
  }
}

/** Scales the two axes of the view independently, each by how far the cursor has moved from the pivot along it. */
export class StretchTool extends PointDrag {
  private pivot: Vec3 = [0, 0, 0];
  private pivotScreen = { x: 0, y: 0 };
  /** Which world axes run along the screen's x and y in this view. */
  private across: [number, number] = [0, 1];

  constructor(state: ModelerState) {
    super(state, 'Stretch');
  }

  protected override start(view: ViewInfo): boolean {
    const center = this.state.pivotFor(this.ids);
    if (!center) return false;
    this.pivot = center;
    this.state.dragPivot = center;
    this.pivotScreen = view.project(center);
    const plane = [0, 1, 2].filter((k) => Math.abs(view.viewAxis[k]!) < 0.5);
    const reach = (k: number) => {
      const tip: Vec3 = [...center];
      tip[k] = center[k]! + 1;
      return view.project(tip);
    };
    const [a, b] = plane as [number, number];
    // the axis that runs more horizontally on screen is the screen's x
    this.across = Math.abs(reach(a).x - this.pivotScreen.x) >= Math.abs(reach(b).x - this.pivotScreen.x) ? [a, b] : [b, a];
    return true;
  }

  move({ start, current }: DragMove): void {
    const { x, y } = this.pivotScreen;
    const ratio = (c: number, s: number, o: number) => Math.max(Math.max(Math.abs(c - o), MIN_STRETCH_RADIUS) / Math.max(Math.abs(s - o), MIN_STRETCH_RADIUS), MIN_SCALE);
    const factors: Vec3 = [1, 1, 1];
    factors[this.across[0]] = ratio(current.x, start.x, x);
    factors[this.across[1]] = ratio(current.y, start.y, y);
    this.transform(deformer(this.before, { kind: 'stretch', factors }, this.pivot));
  }
}

/** Moves the one point nearest the press, anywhere in the layer, whether or not it is selected. */
export class PointDragTool extends PointDrag {
  constructor(state: ModelerState) {
    super(state, 'Drag');
  }

  protected override choosePoints(view: ViewInfo, press: { x: number; y: number }): number[] {
    let best = -1;
    let bestDistance = GRAB_RADIUS;
    let bestDepth = -Infinity;
    this.state.mesh.points.forEach((p, i) => {
      const s = view.project(p);
      const d = Math.hypot(s.x - press.x, s.y - press.y);
      const depth = p[0] * view.viewAxis[0] + p[1] * view.viewAxis[1] + p[2] * view.viewAxis[2];
      // of points that overlap on screen, take the one nearest the viewer
      if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && d < GRAB_RADIUS && depth > bestDepth)) {
        best = i;
        bestDistance = d;
        bestDepth = depth;
      }
    });
    return best < 0 ? [] : [best];
  }

  move({ offset }: DragMove): void {
    this.transform((p): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
  }
}

/** Pulls every point of the layer within a radius of the press, by less the further it is from it. */
export class MagnetTool extends PointDrag {
  private center: Vec3 = [0, 0, 0];
  private viewAxis: Vec3 = [0, 0, 1];
  private radius = 1;

  constructor(
    state: ModelerState,
    private options: () => { radius: number },
  ) {
    super(state, 'Magnet');
  }

  protected override choosePoints(view: ViewInfo, press: { x: number; y: number }): number[] {
    this.radius = this.options().radius;
    if (!view.unproject || !(this.radius > 0)) return [];
    this.center = view.unproject(press.x, press.y);
    this.viewAxis = view.viewAxis;
    const [ax, ay, az] = view.viewAxis;
    const length = Math.hypot(ax, ay, az) || 1;
    const across = (p: Vec3) => {
      const d: Vec3 = [p[0] - this.center[0], p[1] - this.center[1], p[2] - this.center[2]];
      const along = (d[0] * ax + d[1] * ay + d[2] * az) / (length * length);
      return Math.hypot(d[0] - along * ax, d[1] - along * ay, d[2] - along * az);
    };
    const ids: number[] = [];
    this.state.mesh.points.forEach((p, i) => magnetWeight(across(p), this.radius) > 0 && ids.push(i));
    return ids;
  }

  move({ offset }: DragMove): void {
    this.transform(magnet(this.center, this.viewAxis, this.radius, offset));
  }
}
