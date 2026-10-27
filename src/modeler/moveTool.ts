import type { Vec3 } from '@/core';
import { PointDrag, type DragMove } from './pointDrag';
import type { ModelerState } from './state';

/** Drags points by a world-space offset. Like LightWave, with nothing selected it moves the whole object. */
export class MoveTool extends PointDrag {
  constructor(state: ModelerState) {
    super(state, 'Move');
  }

  move({ offset }: DragMove): void {
    this.transform((p): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
  }
}
