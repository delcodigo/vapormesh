import { planeThroughLine, type KnifeOptions } from './knife';
import { knifeSelection, type EditResult } from './edit';
import type { DragMove, DragTool, ViewInfo } from './pointDrag';
import type { ModelerState } from './state';

/** A line shorter than this many pixels is a slip of the hand, not a cut. */
const MIN_LINE_PIXELS = 8;

/**
 * Drag a line across a view to cut the selected polygons (or all of them) along the plane through that line and the way the
 * view looks. Nothing changes while dragging; the viewport draws the line, and releasing makes the cut as one undo step.
 */
export class KnifeTool implements DragTool {
  private view: ViewInfo | null = null;
  private last: DragMove | null = null;

  constructor(
    private state: ModelerState,
    private options: () => KnifeOptions,
    private onResult?: (result: EditResult) => void,
  ) {}

  begin(view: ViewInfo): boolean {
    if (!view.isOrtho || !view.unproject) return false;
    this.view = view;
    this.last = null;
    return true;
  }

  move(info: DragMove): void {
    this.last = info;
  }

  end(final?: DragMove): void {
    const info = final ?? this.last;
    const view = this.view;
    this.cancel();
    if (!info || !view?.unproject) return;
    if (Math.hypot(info.current.x - info.start.x, info.current.y - info.start.y) < MIN_LINE_PIXELS) return;
    const a = view.unproject(info.start.x, info.start.y);
    const b = view.unproject(info.current.x, info.current.y);
    this.onResult?.(knifeSelection(this.state, planeThroughLine(a, b, view.viewAxis), this.options()));
  }

  cancel(): void {
    this.view = null;
    this.last = null;
  }
}
