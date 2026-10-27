import type { Vec3 } from '@/core';
import type { ViewKind } from './viewport';

/** A viewport's camera as saved in a project. Only the fields that matter for the view's kind are written. */
export interface ViewState {
  /** Point the view is centred on. */
  target: Vec3;
  /** Orthographic views: world units visible vertically. */
  orthoSize?: number;
  /** Perspective view: orbit distance, azimuth and polar angle (from +Y). */
  radius?: number;
  theta?: number;
  phi?: number;
}

export type FullView = Required<ViewState>;

export const DEFAULT_VIEW: FullView = {
  target: [0, 0, 0],
  orthoSize: 4,
  radius: 6,
  theta: Math.atan2(3, 4),
  phi: 1.0,
};

export const VIEW_LIMITS = {
  orthoSize: [0.01, 100000],
  radius: [0.2, 500],
  phi: [0.05, Math.PI - 0.05],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(Math.max(v, lo), hi);
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Fill in anything missing from the defaults and clamp the rest, so a camera built from a file is always usable. */
export function normalizeView(v: Partial<ViewState>): FullView {
  const t = v.target;
  return {
    target: [finite(t?.[0], 0), finite(t?.[1], 0), finite(t?.[2], 0)],
    orthoSize: clamp(finite(v.orthoSize, DEFAULT_VIEW.orthoSize), VIEW_LIMITS.orthoSize),
    radius: clamp(finite(v.radius, DEFAULT_VIEW.radius), VIEW_LIMITS.radius),
    theta: finite(v.theta, DEFAULT_VIEW.theta),
    phi: clamp(finite(v.phi, DEFAULT_VIEW.phi), VIEW_LIMITS.phi),
  };
}

/** The part of a full camera worth saving for this kind of view. */
export function relevantView(kind: ViewKind, v: FullView): ViewState {
  return kind === 'perspective'
    ? { target: [...v.target], radius: v.radius, theta: v.theta, phi: v.phi }
    : { target: [...v.target], orthoSize: v.orthoSize };
}

/** Which two world axes an orthographic view shows, as (horizontal, vertical). */
export const ORTHO_PLANES = { top: [0, 2], face: [0, 1], left: [2, 1] } as const;

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** The box round some points, ignoring any that are not finite. Null if there are none. */
export function boundsOf(points: Iterable<Vec3>): Bounds | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  return any ? { min, max } : null;
}

/** How much room to leave round the model when framing it, as a factor on its size. */
export const FRAME_MARGIN = 1.2;

/**
 * A camera that shows a whole box, centred. Orthographic views zoom until both the box's width and height fit the view's shape
 * (`aspect` is width / height); the Perspective view keeps its angle and moves back until the box's bounding sphere fits both
 * the vertical and the horizontal field of view. A box with no size (one point) keeps the current zoom.
 */
export function fitView(kind: ViewKind, box: Bounds, aspect: number, fovDegrees: number, current: FullView): FullView {
  const size: Vec3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const target: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (kind === 'perspective') {
    const sphere = Math.hypot(...size) / 2;
    if (sphere === 0) return normalizeView({ ...current, target });
    const vertical = (fovDegrees * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * safeAspect);
    const half = Math.min(vertical, horizontal) / 2;
    return normalizeView({ ...current, target, radius: (sphere / Math.sin(half)) * FRAME_MARGIN });
  }
  const [h, v] = ORTHO_PLANES[kind];
  const needed = Math.max(size[v]!, size[h]! / safeAspect);
  return normalizeView({ ...current, target, orthoSize: needed === 0 ? current.orthoSize : needed * FRAME_MARGIN });
}
