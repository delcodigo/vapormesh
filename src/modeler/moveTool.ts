import type { Vec3 } from '@/core';
import { PointDrag, type DragMove } from './pointDrag';
import { snapOffset } from './selectTools';
import type { ModelerState } from './state';

/**
 * Drags points by a world-space offset (the viewport only starts it when something is selected; the tool itself moves the whole object if not). With grid snapping
 * on, the offset moves in whole grid steps. With axes locked, only those components of the offset apply.
 */
export class MoveTool extends PointDrag {
  constructor(state: ModelerState) {
    super(state, 'Move');
  }

  move(info: DragMove): void {
    const snapped = snapOffset(info.offset, this.state.snap);
    const locked = this.state.lockedAxes();
    const offset = locked.length ? (snapped.map((c, k) => (locked.includes(k) ? c : 0)) as Vec3) : snapped;
    this.transform((p): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
  }
}
