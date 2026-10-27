import { describe, expect, it } from 'vitest';
import type { EditResult } from './edit';
import { KnifeTool } from './knifeTool';
import type { DragMove, ViewInfo } from './pointDrag';
import { box } from './primitives';
import { ModelerState } from './state';

// A Face-like view: +X right, +Y up, seen from +Z, 100 pixels per unit, the origin at pixel (0, 0).
const view: ViewInfo = {
  isOrtho: true,
  viewAxis: [0, 0, 1],
  project: ([x, y]) => ({ x: x * 100, y: -y * 100 }),
  unproject: (x, y) => [x / 100, -y / 100, 0],
};
const line = (x0: number, y0: number, x1: number, y1: number): DragMove => ({ offset: [0, 0, 0], start: { x: x0, y: y0 }, current: { x: x1, y: y1 } });

function setup() {
  const s = new ModelerState(box());
  const results: EditResult[] = [];
  const tool = new KnifeTool(s, () => ({ separate: false }), (r) => results.push(r));
  return { s, tool, results };
}

describe('KnifeTool', () => {
  it('only works in orthographic views that can turn a pixel back into a point', () => {
    const { tool } = setup();
    expect(tool.begin({ ...view, isOrtho: false })).toBe(false);
    expect(tool.begin({ ...view, unproject: undefined })).toBe(false);
    expect(tool.begin(view)).toBe(true);
  });

  it('cuts along the line dragged, as one undo step, and reports what it did', () => {
    const { s, tool, results } = setup();
    tool.begin(view);
    tool.move(line(0, -150, 0, 150)); // a vertical line down the middle of the face view: the plane x = 0
    tool.end(line(0, -150, 0, 150));
    expect(s.mesh.polygons).toHaveLength(10);
    expect(results).toEqual([{ ok: true, message: 'Cut 4 polygons' }]);
    expect(s.history.undoLabel).toBe('Knife');
    s.undo();
    expect(s.mesh.polygons).toHaveLength(6);
  });

  it('a diagonal line cuts along a diagonal plane', () => {
    const { s, tool } = setup();
    tool.begin(view);
    tool.end(line(-100, 100, 100, -100)); // pixel (-100, 100) is world (-1, -1), (100, -100) is (1, 1): the line y = x
    expect(s.mesh.polygons.length).toBeGreaterThan(6);
    const onCut = [...s.selectedPoints].map((i) => s.mesh.points[i]!);
    expect(onCut.length).toBeGreaterThan(0);
    for (const p of onCut) expect(p[0]).toBeCloseTo(p[1], 9);
  });

  it('the depth of the line is irrelevant: the cut goes through the whole object, front to back', () => {
    const { s, tool } = setup();
    tool.begin(view);
    tool.end(line(20, -300, 20, 300));
    const cut = [...s.selectedPoints].map((i) => s.mesh.points[i]!);
    expect(new Set(cut.map((p) => p[2])).size).toBe(2); // both the front and back faces were cut
    expect(cut.every((p) => Math.abs(p[0] - 0.2) < 1e-9)).toBe(true);
  });

  it('ignores a tiny drag instead of cutting', () => {
    const { s, tool, results } = setup();
    tool.begin(view);
    tool.end(line(0, 0, 3, 3));
    expect(s.history.canUndo).toBe(false);
    expect(results).toEqual([]);
  });

  it('uses the last move when the end gives no position, and nothing if it never moved', () => {
    const { s, tool } = setup();
    tool.begin(view);
    tool.move(line(0, -150, 0, 150));
    tool.end();
    expect(s.mesh.polygons).toHaveLength(10);

    const again = setup();
    again.tool.begin(view);
    again.tool.end();
    expect(again.s.history.canUndo).toBe(false);
  });

  it('cancel drops the drag without cutting', () => {
    const { s, tool } = setup();
    tool.begin(view);
    tool.move(line(0, -150, 0, 150));
    tool.cancel();
    tool.end();
    expect(s.mesh.polygons).toHaveLength(6);
  });

  it('reports a line that misses the model', () => {
    const { tool, results } = setup();
    tool.begin(view);
    tool.end(line(900, -300, 900, 300));
    expect(results).toEqual([{ ok: false, message: 'The cut does not pass through any polygon' }]);
  });
});
