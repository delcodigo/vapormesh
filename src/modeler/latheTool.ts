import type { Vec3 } from '@/core';
import { checkLathe, ReplaceGeometryCommand, snapshotSelection, type EditResult, type LatheSettings, type Selection } from './edit';
import { cloneGeometry, type Geometry } from './geometry';
import { lathe, type LatheResult } from './lathe';
import type { DragMove, DragTool, ViewInfo } from './pointDrag';
import { snapValue } from './selectTools';
import type { ModelerState } from './state';

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/**
 * Lathe the selected profile points by dragging in an orthographic view: the press and the drag place the axis, and the
 * shape follows the pointer. The axis keeps the direction chosen in the options; the view only sets where it is across the
 * view (a Y axis seen from the front is set in X, seen from above in X and Z). Every move rebuilds the lathe from the
 * original geometry, so it never drifts, and one drag is one undo step.
 */
export class LatheTool implements DragTool {
  private view: ViewInfo | null = null;
  private base: Geometry | null = null;
  private selectionBefore: Selection | null = null;
  private profile: number[] = [];
  private settings: LatheSettings | null = null;
  private result: LatheResult | null = null;

  constructor(
    private state: ModelerState,
    private options: () => LatheSettings,
    /** Told where the axis ended up, so the panel's fields show it. */
    private onCenter: (center: Vec3) => void,
    private onResult?: (result: EditResult) => void,
  ) {}

  begin(view: ViewInfo, press?: { x: number; y: number }): boolean {
    if (!view.isOrtho || !view.unproject) return false;
    const settings = this.options();
    const checked = checkLathe(this.state, settings);
    if ('error' in checked) {
      this.onResult?.({ ok: false, message: checked.error });
      return false;
    }
    this.view = view;
    this.settings = settings;
    this.profile = checked.profile;
    this.base = cloneGeometry(this.state.mesh);
    this.selectionBefore = snapshotSelection(this.state);
    this.result = null;
    this.place(press ?? { x: 0, y: 0 });
    return true;
  }

  move({ current }: DragMove): void {
    this.place(current);
  }

  /** Put the axis under a canvas point and show the lathe it makes. */
  private place(at: { x: number; y: number }): void {
    const { view, settings, base } = this;
    if (!view?.unproject || !settings || !base) return;
    const point = view.unproject(at.x, at.y);
    const center: Vec3 = [...settings.center];
    for (let k = 0; k < 3; k++) {
      // only the directions this view shows, and never along the axis itself, where moving it changes nothing
      if (Math.abs(view.viewAxis[k]!) < 0.5 && k !== AXIS_INDEX[settings.axis]) center[k] = snapValue(point[k]!, this.state.snap) + 0;
    }
    this.onCenter(center);
    this.result = lathe(base, this.profile, { ...settings, center });
    this.show(this.result.newPolygons.length ? this.result.geometry : base);
  }

  end(): void {
    const { base, result, selectionBefore, settings } = this;
    this.reset();
    if (!base || !result || !settings || result.newPolygons.length === 0) {
      if (base) this.show(base);
      this.onResult?.({ ok: false, message: 'The profile lies on the axis, so there is nothing to spin' });
      return;
    }
    // the mesh already shows the result; executing re-applies it, selects the new polygons and records one undo step
    this.state.execute(
      new ReplaceGeometryCommand('Lathe', this.state, result.geometry, { points: result.newPoints, polygons: result.newPolygons }, { geometry: base, selection: selectionBefore! }),
    );
    this.onResult?.({ ok: true, message: `Made ${result.newPolygons.length} polygons about ${settings.axis.toUpperCase()}` });
  }

  /** Abandon the drag and put the original geometry back. */
  cancel(): void {
    if (this.base) this.show(this.base);
    this.reset();
  }

  private show(geo: Geometry): void {
    const copy = cloneGeometry(geo);
    this.state.mesh.points = copy.points;
    this.state.mesh.polygons = copy.polygons;
    this.state.mesh.hidden.clear();
    this.state.changed();
  }

  private reset(): void {
    this.view = null;
    this.base = null;
    this.result = null;
    this.selectionBefore = null;
    this.profile = [];
    this.settings = null;
  }
}
