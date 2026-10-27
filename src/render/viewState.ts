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
