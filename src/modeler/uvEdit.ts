import type { Mesh, UV } from '@/core';
import type { ModelerState } from './state';
import { SetUvsCommand } from './uvTools';

// --- corners ---------------------------------------------------------------------------------------------------

/** A polygon corner packed into one number, so corners fit in a Set. */
export const cornerKey = (polygon: number, corner: number) => polygon * 65536 + corner;

export interface UvCorner {
  key: number;
  polygon: number;
  corner: number;
  /** The mesh point this corner belongs to. */
  point: number;
  u: number;
  v: number;
}

/** Every corner, with its UV, of the given polygons that have UVs. */
export function uvCorners(mesh: Mesh, polygons: number[]): UvCorner[] {
  const out: UvCorner[] = [];
  for (const polygon of polygons) {
    const poly = mesh.polygons[polygon];
    if (!poly?.uvs) continue;
    poly.uvs.forEach(([u, v], corner) => out.push({ key: cornerKey(polygon, corner), polygon, corner, point: poly.points[corner]!, u, v }));
  }
  return out;
}

const SAME = 1e-6;

/** The corners grouped by the point of the model they belong to. Build it once and pass it to `weldGroup` when asking many times. */
export function weldIndex(corners: UvCorner[]): Map<number, UvCorner[]> {
  const byPoint = new Map<number, UvCorner[]>();
  for (const c of corners) {
    const list = byPoint.get(c.point);
    if (list) list.push(c);
    else byPoint.set(c.point, [c]);
  }
  return byPoint;
}

/**
 * Corners that are the same point of the model at the same place in the texture. They move together, so a seam that
 * is closed stays closed; a point that was split on purpose (different UVs) is a different group. Without an index it scans
 * every corner, which is fine once; for a whole box of corners pass `weldIndex(corners)`.
 */
export function weldGroup(corners: UvCorner[], of: UvCorner, index?: Map<number, UvCorner[]>): number[] {
  const candidates = index ? (index.get(of.point) ?? []) : corners;
  return candidates.filter((c) => c.point === of.point && Math.abs(c.u - of.u) < SAME && Math.abs(c.v - of.v) < SAME).map((c) => c.key);
}

/** The corner nearest to a screen position, within `radius` pixels (the first, if several are equally near). */
export function pickCorner(corners: UvCorner[], toScreen: (u: number, v: number) => [number, number], x: number, y: number, radius = 8): UvCorner | null {
  let best: UvCorner | null = null;
  let bestDist = Infinity;
  for (const c of corners) {
    const [sx, sy] = toScreen(c.u, c.v);
    const d = Math.hypot(sx - x, sy - y);
    if (d <= radius && d < bestDist) {
      // strictly nearer wins, so of several corners at one spot (a welded seam) the first is returned
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Corners whose screen position lies inside a rectangle (corners in any order). */
export function cornersInRect(
  corners: UvCorner[],
  toScreen: (u: number, v: number) => [number, number],
  rect: { x0: number; y0: number; x1: number; y1: number },
): UvCorner[] {
  const [lx, hx] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
  const [ly, hy] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  return corners.filter((c) => {
    const [x, y] = toScreen(c.u, c.v);
    return x >= lx && x <= hx && y >= ly && y <= hy;
  });
}

// --- transforms --------------------------------------------------------------------------------------------------

/** Snap a UV to the texel grid of a texture. */
export const snapUv = ([u, v]: UV, texWidth: number, texHeight: number): UV => [Math.round(u * texWidth) / texWidth, Math.round(v * texHeight) / texHeight];

/** With snapping on, rotation moves in steps of this many radians (15 degrees). */
export const SNAP_ANGLE = Math.PI / 12;

export type UvToolKind = 'move' | 'rotate' | 'size';

export interface UvDragOptions {
  /** Snap results to the texel grid (move, size) or to 15 degree steps (rotate). */
  snap: boolean;
  texWidth: number;
  texHeight: number;
  /** Size tool: the smallest cursor distance from the pivot used as a ratio base, so a press next to it can't explode. */
  minRadius: number;
}

const LABELS: Record<UvToolKind, string> = { move: 'Move UVs', rotate: 'Rotate UVs', size: 'Size UVs' };
const copyUvs = (uvs: UV[] | undefined) => uvs?.map((uv): UV => [...uv]);

/**
 * Drags UV corners in UV space. Like the 3D tools it works from the positions captured at `begin`, so repeated
 * `move` calls never drift, and `end` records one undo step. Pivot (rotate, size) is the centre of the corners' bounds.
 */
export class UvDrag {
  private polygons: number[] = [];
  private before: (UV[] | undefined)[] = [];
  private base: { polygon: number; corner: number; uv: UV }[] = [];
  private pivot: UV = [0, 0];
  private options!: UvDragOptions;

  constructor(
    private state: ModelerState,
    private kind: UvToolKind,
  ) {}

  /** Returns false if there is nothing to drag. */
  begin(corners: UvCorner[], options: UvDragOptions): boolean {
    if (corners.length === 0) return false;
    const { mesh } = this.state;
    this.options = options;
    this.base = corners.map((c) => ({ polygon: c.polygon, corner: c.corner, uv: [c.u, c.v] }));
    this.polygons = [...new Set(corners.map((c) => c.polygon))];
    this.before = this.polygons.map((p) => copyUvs(mesh.polygons[p]!.uvs));
    const us = corners.map((c) => c.u);
    const vs = corners.map((c) => c.v);
    this.pivot = [(Math.min(...us) + Math.max(...us)) / 2, (Math.min(...vs) + Math.max(...vs)) / 2];
    return true;
  }

  /** `start` and `current` are the pointer's UV positions at the press and now. */
  move(start: UV, current: UV): void {
    const { texWidth, texHeight, snap, minRadius } = this.options;
    const [px, py] = this.pivot;
    let place: (uv: UV) => UV;
    if (this.kind === 'move') {
      const [du, dv] = [current[0] - start[0], current[1] - start[1]];
      place = ([u, v]) => [u + du, v + dv];
    } else if (this.kind === 'rotate') {
      let angle = Math.atan2(current[1] - py, current[0] - px) - Math.atan2(start[1] - py, start[0] - px);
      if (snap) angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      // u right, v down, like the screen: a positive angle turns clockwise, following the cursor
      place = ([u, v]) => [px + (u - px) * cos - (v - py) * sin, py + (u - px) * sin + (v - py) * cos];
    } else {
      const radius = (p: UV) => Math.max(Math.hypot(p[0] - px, p[1] - py), minRadius);
      const f = Math.max(radius(current) / radius(start), 0.001);
      place = ([u, v]) => [px + (u - px) * f, py + (v - py) * f];
    }
    const { mesh } = this.state;
    for (const { polygon, corner, uv } of this.base) {
      const moved = place(uv);
      mesh.polygons[polygon]!.uvs![corner] = snap && this.kind !== 'rotate' ? snapUv(moved, texWidth, texHeight) : moved;
    }
    this.state.changed();
  }

  end(): void {
    const { mesh } = this.state;
    const after = this.polygons.map((p) => copyUvs(mesh.polygons[p]!.uvs));
    const changed = JSON.stringify(after) !== JSON.stringify(this.before);
    const cmd = changed && new SetUvsCommand(LABELS[this.kind], mesh, this.polygons, after, this.before);
    this.reset();
    if (cmd) this.state.record(cmd);
    else this.state.changed();
  }

  /** Abandon the drag and put the UVs back. */
  cancel(): void {
    const { mesh } = this.state;
    this.polygons.forEach((p, i) => {
      const uvs = copyUvs(this.before[i]);
      if (uvs) mesh.polygons[p]!.uvs = uvs;
    });
    this.reset();
    this.state.changed();
  }

  private reset(): void {
    this.polygons = [];
    this.before = [];
    this.base = [];
  }
}
